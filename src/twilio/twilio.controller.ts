import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  Headers,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { TwilioService } from './twilio.service';
import { InitiateCallDto } from './dto/initiate-call.dto';
import { DialCallDto } from './dto/dial-call.dto';
import { SendSmsDto } from './dto/send-sms.dto';

/** Extended request with raw body set by middleware for Twilio webhook signature validation */
interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/** Safe TwiML so we never return 5xx to Twilio (avoids "An application error has occurred"). */
const VOICE_CONNECT_ERROR_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">We could not connect your call. Please try again.</Say><Hangup/></Response>';

@ApiTags('twilio')
@Controller('twilio')
export class TwilioController {
  private readonly logger = new Logger(TwilioController.name);

  constructor(private twilio: TwilioService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Whether Twilio click-to-call, browser calling, and SMS are configured' })
  status() {
    return {
      data: {
        configured: this.twilio.isConfigured(),
        browserConfigured: this.twilio.isBrowserConfigured(),
      },
    };
  }

  @Get('client/token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate Twilio Access Token for browser (WebRTC) calling' })
  async getBrowserToken(
    @Query('leadId') leadId: string | undefined,
    @Query('to') to: string | undefined,
    @Query('scriptPlaybookId') scriptPlaybookId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    const data = await this.twilio.generateBrowserToken(
      user.sub,
      leadId ?? null,
      to ?? null,
      access,
      scriptPlaybookId,
    );
    return { data };
  }

  @Post('call/initiate')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Start click-to-call: ring current user then connect to lead' })
  async initiateCall(
    @Body() dto: InitiateCallDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    const result = await this.twilio.initiateClickToCall(
      dto.leadId,
      user.sub,
      access,
      dto.scriptPlaybookId,
    );
    return { data: result };
  }

  @Post('call/dial')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Manual dial: ring current user then connect to any number' })
  async dialCall(
    @Body() dto: DialCallDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.twilio.initiateManualCall(dto.to, user.sub);
    return { data: result };
  }

  /** TwiML for voice/connect: token from query (GET) or body (POST). Twilio may use either method. */
  private async voiceConnectHandler(
    token: string | undefined,
    res: Response,
  ): Promise<void> {
    const sendSafe = () => {
      if (res.headersSent) return;
      try {
        res.status(200).setHeader('Content-Type', 'text/xml').send(VOICE_CONNECT_ERROR_TWIML);
      } catch {
        this.logger.error('Failed to send VOICE_CONNECT_ERROR_TWIML (response may already be sent)');
      }
    };
    try {
      if (!token) {
        res.status(200).setHeader('Content-Type', 'text/xml').send(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Missing token. Goodbye.</Say><Hangup/></Response>',
        );
        return;
      }
      const twiml = await this.twilio.getConnectTwiML(token);
      if (res.headersSent) return;
      res.setHeader('Content-Type', 'text/xml');
      res.status(200).send(twiml);
    } catch (err) {
      this.logger.warn(`voice/connect error: ${err instanceof Error ? err.message : String(err)}`);
      sendSafe();
    }
  }

  @Get('voice/connect')
  @Public()
  @ApiOperation({ summary: 'TwiML: dial lead contact when agent answers (GET)' })
  async voiceConnectGet(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    await this.voiceConnectHandler(token, res);
  }

  @Post('voice/connect')
  @Public()
  @ApiOperation({ summary: 'TwiML: dial lead contact when agent answers (POST – Twilio may use POST)' })
  async voiceConnectPost(
    @Query('token') tokenFromQuery: string | undefined,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    const token = tokenFromQuery ?? body?.token;
    await this.voiceConnectHandler(token, res);
  }

  @Post('voice/connect-gather')
  @Public()
  @ApiOperation({ summary: 'TwiML Gather action: called when agent presses a key, dials lead' })
  async voiceConnectGather(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    try {
      if (!token) {
        res.status(200).setHeader('Content-Type', 'text/xml').send(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Missing token. Goodbye.</Say><Hangup/></Response>',
        );
        return;
      }
      const twiml = await this.twilio.getGatherActionTwiML(token);
      res.setHeader('Content-Type', 'text/xml');
      res.status(200).send(twiml);
    } catch {
      res.status(200).setHeader('Content-Type', 'text/xml').send(VOICE_CONNECT_ERROR_TWIML);
    }
  }

  @Post('voice/browser')
  @Public()
  @ApiOperation({ summary: 'TwiML App Voice webhook for browser (WebRTC) calls; dials lead' })
  async voiceBrowser(
    @Res() res: Response,
    @Body() body: Record<string, string>,
  ) {
    try {
      const token = body.token ?? '';
      const callSid = body.CallSid ?? '';
      if (!token) {
        res.status(200).setHeader('Content-Type', 'text/xml').send(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Missing token. Goodbye.</Say><Hangup/></Response>',
        );
        return;
      }
      const twiml = await this.twilio.getBrowserVoiceTwiML(token, callSid);
      res.setHeader('Content-Type', 'text/xml');
      res.status(200).send(twiml);
    } catch {
      res.status(200).setHeader('Content-Type', 'text/xml').send(VOICE_CONNECT_ERROR_TWIML);
    }
  }

  @Get('call-records')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List call records for a lead, or recent inbound/unassigned calls' })
  async getCallRecords(
    @Query('leadId') leadId: string | undefined,
    @Query('direction') direction: 'inbound' | 'outbound' | undefined,
    @Query('limit') limitStr: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (leadId) {
      const data = await this.twilio.getCallRecordsForLead(leadId, user.sub, user.role);
      return { data };
    }
    if (direction === 'inbound') {
      const limit = Math.min(Math.max(parseInt(limitStr ?? '50', 10) || 50, 1), 200);
      const data = await this.twilio.getRecentInboundCalls(user.sub, user.role, limit);
      return { data };
    }
    return { data: [] };
  }

  @Patch('call-records/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update call record disposition, notes, outcome score, sentiment' })
  async updateCallRecord(
    @Param('id') id: string,
    @Body() body: { disposition?: string; outcomeScore?: number; notes?: string; sentiment?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.twilio.updateCallRecord(
      id,
      user.sub,
      user.role,
      body,
    );
    return { data };
  }

  @Post('voice/incoming')
  @Public()
  @ApiOperation({ summary: 'Twilio inbound voice webhook: log call (client or unknown), return TwiML' })
  async voiceIncoming(
    @Req() req: RequestWithRawBody,
    @Res() res: Response,
    @Headers('x-twilio-signature') signature: string,
    @Body() body: Record<string, string>,
  ) {
    const safeTwiml =
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">We are sorry, something went wrong. Please try again later.</Say><Hangup/></Response>';
    try {
      if (!signature) {
        res.status(200).setHeader('Content-Type', 'text/xml').send(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Goodbye.</Say><Hangup/></Response>',
        );
        return;
      }
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const valid = this.twilio.validateRequest(signature, url, body);
      if (!valid) {
        res.status(200).setHeader('Content-Type', 'text/xml').send(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Goodbye.</Say><Hangup/></Response>',
        );
        return;
      }
      const twiml = await this.twilio.handleInboundVoice({
        CallSid: body.CallSid ?? '',
        From: body.From ?? '',
        To: body.To ?? '',
        CallStatus: body.CallStatus,
      });
      res.setHeader('Content-Type', 'text/xml');
      res.status(200).send(twiml);
    } catch {
      res.setHeader('Content-Type', 'text/xml');
      res.status(200).send(safeTwiml);
    }
  }

  @Post('voice/status')
  @Public()
  @ApiOperation({ summary: 'Twilio call status callback (no auth, Twilio signature)' })
  async voiceStatus(
    @Req() req: RequestWithRawBody,
    @Headers('x-twilio-signature') signature: string,
    @Body() body: Record<string, string>,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Missing signature');
    }
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const valid = this.twilio.validateRequest(signature, url, body);
    if (!valid) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }
    await this.twilio.handleCallStatus({
      CallSid: body.CallSid,
      CallStatus: body.CallStatus,
      CallDuration: body.CallDuration,
    });
  }

  @Post('sms/send')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Send SMS to lead primary contact or contact' })
  async sendSms(
    @Body() dto: SendSmsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    const result = await this.twilio.sendSms(
      dto.body,
      { leadId: dto.leadId, contactId: dto.contactId },
      user.sub,
      access,
    );
    return { data: result };
  }

  @Get('sms/thread')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get SMS thread for lead or contact' })
  async getSmsThread(
    @Query('leadId') leadId: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return this.twilio.getSmsThread(
      { leadId, contactId },
      access,
    );
  }

  @Post('sms/incoming')
  @Public()
  @ApiOperation({ summary: 'Twilio incoming SMS webhook (no auth, Twilio signature)' })
  async smsIncoming(
    @Req() req: RequestWithRawBody,
    @Headers('x-twilio-signature') signature: string,
    @Body() body: Record<string, string>,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Missing signature');
    }
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const valid = this.twilio.validateRequest(signature, url, body);
    if (!valid) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }
    await this.twilio.handleIncomingSms({
      From: body.From,
      To: body.To,
      Body: body.Body ?? '',
      MessageSid: body.MessageSid ?? '',
    });
  }
}
