import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { ActivitiesService } from '../activities/activities.service';
import * as crypto from 'crypto';
import * as twilio from 'twilio';

const CONNECT_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLIENT_TOKEN_TTL_S = 300; // 5 minutes

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8');
}

/** Normalize to E.164-like digits for comparison (strip + and non-digits, then ensure + prefix) */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const withPlus = digits.length === 11 && digits.startsWith('1') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return withPlus;
}

@Injectable()
export class TwilioService {
  private client: twilio.Twilio | null = null;
  private accountSid: string | null = null;
  private authToken: string | null = null;
  private phoneNumber: string | null = null;
  private callbackBaseUrl: string | null = null;
  /** If set, inbound calls are forwarded to this number (E.164). Else we play a message and hang up. */
  private inboundForwardNumber: string | null = null;
  /** Optional Twilio API Key SID for signing browser access tokens. Falls back to authToken. */
  private apiKeySid: string | null = null;
  /** Optional Twilio API Key Secret for signing browser access tokens. Falls back to authToken. */
  private apiKeySecret: string | null = null;
  /** TwiML Application SID for browser (WebRTC) calling. */
  private twimlAppSid: string | null = null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private leadsService: LeadsService,
    private activitiesService: ActivitiesService,
  ) {
    this.accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID') ?? null;
    this.authToken = this.config.get<string>('TWILIO_AUTH_TOKEN') ?? null;
    this.phoneNumber = this.config.get<string>('TWILIO_PHONE_NUMBER') ?? null;
    this.callbackBaseUrl =
      this.config.get<string>('TWILIO_STATUS_CALLBACK_BASE_URL') ?? null;
    this.inboundForwardNumber =
      this.config.get<string>('TWILIO_INBOUND_FORWARD_NUMBER') ?? null;
    this.apiKeySid = this.config.get<string>('TWILIO_API_KEY_SID') ?? null;
    this.apiKeySecret = this.config.get<string>('TWILIO_API_KEY_SECRET') ?? null;
    this.twimlAppSid = this.config.get<string>('TWILIO_TWIML_APP_SID') ?? null;
    if (this.accountSid && this.authToken) {
      this.client = twilio(this.accountSid, this.authToken);
    }
  }

  isConfigured(): boolean {
    return !!(this.client && this.phoneNumber);
  }

  isBrowserConfigured(): boolean {
    return !!(this.client && this.twimlAppSid && this.accountSid && (this.apiKeySid || this.authToken));
  }

  /** Create a signed token for voice/connect (leadId + expiry). */
  createConnectToken(leadId: string): string {
    if (!this.authToken) throw new BadRequestException('Twilio not configured');
    const expiry = Date.now() + CONNECT_TOKEN_TTL_MS;
    const payload = `${leadId}|${expiry}`;
    const sig = crypto.createHmac('sha256', this.authToken).update(payload).digest('hex');
    return base64UrlEncode(`${payload}.${sig}`);
  }

  /** Verify and decode connect token; returns leadId or throws. */
  verifyConnectToken(token: string): string {
    const result = this.verifyConnectTokenOrManual(token);
    if (result.type === 'manual') throw new BadRequestException('Expected lead token');
    return result.leadId;
  }

  /** Create a signed token for manual dial (ring user then connect to this number). */
  createManualConnectToken(to: string): string {
    if (!this.authToken) throw new BadRequestException('Twilio not configured');
    const normalized = normalizePhone(to);
    if (!normalized) throw new BadRequestException('Invalid phone number');
    const expiry = Date.now() + CONNECT_TOKEN_TTL_MS;
    const payload = `manual|${normalized}|${expiry}`;
    const sig = crypto.createHmac('sha256', this.authToken).update(payload).digest('hex');
    return base64UrlEncode(`${payload}.${sig}`);
  }

  /** Create a signed token for browser (WebRTC) calls. */
  createBrowserConnectToken(userId: string, leadId: string | null, toNumber: string | null): string {
    if (!this.authToken) throw new BadRequestException('Twilio not configured');
    const expiry = Date.now() + CONNECT_TOKEN_TTL_MS;
    const target = leadId ? `lead:${leadId}` : `manual:${toNumber ?? ''}`;
    const payload = `browser|${userId}|${target}|${expiry}`;
    const sig = crypto.createHmac('sha256', this.authToken).update(payload).digest('hex');
    return base64UrlEncode(`${payload}.${sig}`);
  }

  /** Verify and decode a browser connect token. */
  verifyBrowserConnectToken(token: string): { userId: string; leadId: string | null; toNumber: string | null } {
    if (!this.authToken) throw new BadRequestException('Twilio not configured');
    try {
      const decoded = base64UrlDecode(token);
      const dotIdx = decoded.lastIndexOf('.');
      const payload = decoded.slice(0, dotIdx);
      const sig = decoded.slice(dotIdx + 1);
      const expected = crypto.createHmac('sha256', this.authToken).update(payload).digest('hex');
      if (sig !== expected) throw new Error('Invalid signature');
      const parts = payload.split('|');
      if (parts[0] !== 'browser') throw new Error('Not a browser token');
      const expiry = parseInt(parts[parts.length - 1], 10);
      if (Number.isNaN(expiry) || Date.now() > expiry) throw new Error('Token expired');
      const userId = parts[1];
      const targetStr = parts.slice(2, -1).join('|');
      let leadId: string | null = null;
      let toNumber: string | null = null;
      if (targetStr.startsWith('lead:')) {
        leadId = targetStr.slice(5);
      } else if (targetStr.startsWith('manual:')) {
        toNumber = targetStr.slice(7) || null;
      }
      return { userId, leadId, toNumber };
    } catch {
      throw new BadRequestException('Invalid or expired browser connect token');
    }
  }

  /** Verify and decode connect token; returns lead or manual dial target. */
  verifyConnectTokenOrManual(
    token: string,
  ): { type: 'lead'; leadId: string } | { type: 'manual'; to: string } {
    if (!this.authToken) throw new BadRequestException('Twilio not configured');
    try {
      const decoded = base64UrlDecode(token);
      const [payload, sig] = decoded.split('.');
      if (!payload || !sig) throw new Error('Invalid token format');
      const expected = crypto.createHmac('sha256', this.authToken).update(payload).digest('hex');
      if (sig !== expected) throw new Error('Invalid signature');
      const parts = payload.split('|');
      const expiryStr = parts[parts.length - 1];
      const expiry = parseInt(expiryStr, 10);
      if (Number.isNaN(expiry) || Date.now() > expiry) throw new Error('Token expired');
      if (payload.startsWith('manual|')) {
        const to = parts.slice(1, -1).join('|');
        if (!to) throw new Error('Missing manual dial number');
        return { type: 'manual', to };
      }
      const leadId = parts[0];
      if (!leadId) throw new Error('Missing leadId');
      return { type: 'lead', leadId };
    } catch {
      throw new BadRequestException('Invalid or expired connect token');
    }
  }

  validateRequest(signature: string, url: string, params: Record<string, string>): boolean {
    if (!this.authToken) return false;
    return twilio.validateRequest(this.authToken, signature, url, params);
  }

  async initiateClickToCall(
    leadId: string,
    userId: string,
    access?: { role?: string; teamId?: string | null },
    scriptPlaybookId?: string,
  ): Promise<{ callSid: string; message: string }> {
    if (!this.client || !this.phoneNumber || !this.callbackBaseUrl) {
      throw new BadRequestException('Click-to-call is not configured');
    }
    const lead = await this.leadsService.findOne(leadId, access);
    const contact = lead.primaryContact as { id: string; phone: string | null } | null;
    const contactPhone = contact?.phone ? normalizePhone(contact.phone) : null;
    if (!contactPhone) {
      throw new BadRequestException('Lead has no primary contact phone number');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    const userPhone = user?.phone ? normalizePhone(user.phone) : null;
    if (!userPhone) {
      throw new BadRequestException(
        'Add your phone number in profile settings to use click-to-call',
      );
    }
    const connectToken = this.createConnectToken(leadId);
    const base = this.callbackBaseUrl.replace(/\/$/, '');
    const twimlUrl = `${base}/api/v1/twilio/voice/connect?token=${encodeURIComponent(connectToken)}`;
    const statusCallback = `${base}/api/v1/twilio/voice/status`;
    const call = await this.client.calls.create({
      to: userPhone,
      from: this.phoneNumber,
      url: twimlUrl,
      statusCallback,
      statusCallbackEvent: ['completed'],
    });
    await this.prisma.callRecord.create({
      data: {
        leadId,
        contactId: contact?.id ?? null,
        userId,
        twilioCallSid: call.sid,
        direction: 'outbound',
        fromNumber: this.phoneNumber,
        toNumber: userPhone,
        status: call.status ?? 'initiated',
        ...(scriptPlaybookId && { scriptPlaybookId }),
      },
    });
    return {
      callSid: call.sid,
      message: 'Calling your phone now. When you answer, press any key to connect to the lead.',
    };
  }

  async initiateManualCall(
    to: string,
    userId: string,
  ): Promise<{ callSid: string; message: string }> {
    if (!this.client || !this.phoneNumber || !this.callbackBaseUrl) {
      throw new BadRequestException('Click-to-call is not configured');
    }
    const toNormalized = normalizePhone(to);
    if (!toNormalized) {
      throw new BadRequestException('Enter a valid phone number with at least 10 digits');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    const userPhone = user?.phone ? normalizePhone(user.phone) : null;
    if (!userPhone) {
      throw new BadRequestException(
        'Add your phone number in profile settings to use the dialer',
      );
    }
    const connectToken = this.createManualConnectToken(toNormalized);
    const base = this.callbackBaseUrl.replace(/\/$/, '');
    const twimlUrl = `${base}/api/v1/twilio/voice/connect?token=${encodeURIComponent(connectToken)}`;
    const statusCallback = `${base}/api/v1/twilio/voice/status`;
    const call = await this.client.calls.create({
      to: userPhone,
      from: this.phoneNumber,
      url: twimlUrl,
      statusCallback,
      statusCallbackEvent: ['completed'],
    });
    await this.prisma.callRecord.create({
      data: {
        leadId: null,
        contactId: null,
        userId,
        twilioCallSid: call.sid,
        direction: 'outbound',
        fromNumber: this.phoneNumber,
        toNumber: userPhone,
        status: call.status ?? 'initiated',
      },
    });
    return {
      callSid: call.sid,
      message: 'Calling your phone now. When you answer, press any key to connect.',
    };
  }

  /** Safe TwiML when connect fails so Twilio does not play "An application error has occurred". */
  private static readonly CONNECT_ERROR_TWIML =
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">We could not connect your call. Please try again.</Say><Hangup/></Response>';

  /**
   * Generate Gather TwiML returned when the agent's phone is answered.
   * Prompts the agent to press any key, then the Gather action URL dials the lead.
   */
  async getConnectTwiML(token: string): Promise<string> {
    try {
      const decoded = this.verifyConnectTokenOrManual(token);
      const base = (this.callbackBaseUrl ?? '').replace(/\/$/, '');
      const actionUrl = `${base}/api/v1/twilio/voice/connect-gather?token=${encodeURIComponent(token)}`;

      let promptName = 'the lead';
      if (decoded.type === 'manual') {
        const displayTo = decoded.to.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        promptName = displayTo;
      } else {
        const lead = await this.prisma.lead.findFirst({
          where: { id: decoded.leadId, deletedAt: null },
          select: { title: true, primaryContact: { select: { firstName: true, lastName: true } } },
        });
        if (lead) {
          const name = lead.title ?? [lead.primaryContact?.firstName, lead.primaryContact?.lastName].filter(Boolean).join(' ').trim();
          if (name) promptName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
      }

      const actionEscaped = actionUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather numDigits="1" action="${actionEscaped}" method="POST"><Say voice="alice">Press any key to connect to ${promptName}.</Say></Gather><Say voice="alice">No input received. Goodbye.</Say><Hangup/></Response>`;
    } catch {
      return TwilioService.CONNECT_ERROR_TWIML;
    }
  }

  /**
   * Generate TwiML for the Gather action: called after agent presses a key.
   * Returns a Dial TwiML to connect the agent to the lead.
   */
  async getGatherActionTwiML(token: string): Promise<string> {
    try {
      const decoded = this.verifyConnectTokenOrManual(token);
      const callerId = (this.phoneNumber ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');

      if (decoded.type === 'manual') {
        const toEscaped = decoded.to.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${callerId}">${toEscaped}</Dial></Response>`;
      }

      const lead = await this.prisma.lead.findFirst({
        where: { id: decoded.leadId, deletedAt: null },
        include: { primaryContact: true },
      });
      if (!lead?.primaryContact?.phone) {
        return '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Contact phone not found. Goodbye.</Say><Hangup/></Response>';
      }
      const to = normalizePhone(lead.primaryContact.phone);
      if (!to) {
        return '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Invalid contact number. Goodbye.</Say><Hangup/></Response>';
      }
      const toEscaped = to.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${callerId}">${toEscaped}</Dial></Response>`;
    } catch {
      return TwilioService.CONNECT_ERROR_TWIML;
    }
  }

  /**
   * Generate TwiML for browser (WebRTC) calls via the TwiML App Voice webhook.
   */
  async getBrowserVoiceTwiML(token: string, callSid: string): Promise<string> {
    try {
      const decoded = this.verifyBrowserConnectToken(token);
      const callerId = (this.phoneNumber ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');

      let toPhone: string | null = null;
      let displayName = 'the lead';
      const leadId: string | null = decoded.leadId;

      if (decoded.leadId) {
        const lead = await this.prisma.lead.findFirst({
          where: { id: decoded.leadId, deletedAt: null },
          include: { primaryContact: true },
        });
        if (!lead?.primaryContact?.phone) {
          return '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Contact phone not found. Goodbye.</Say><Hangup/></Response>';
        }
        toPhone = normalizePhone(lead.primaryContact.phone);
        const name = lead.title ?? [lead.primaryContact.firstName, lead.primaryContact.lastName].filter(Boolean).join(' ').trim();
        if (name) displayName = name;
      } else if (decoded.toNumber) {
        toPhone = decoded.toNumber;
      }

      if (!toPhone) return TwilioService.CONNECT_ERROR_TWIML;

      // Update pending call record with real CallSid
      await this.prisma.callRecord.updateMany({
        where: {
          userId: decoded.userId,
          twilioCallSid: { startsWith: 'browser_pending_' },
          status: 'initiated',
          ...(leadId ? { leadId } : {}),
        },
        data: { twilioCallSid: callSid },
      });

      const nameEscaped = displayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const toEscaped = toPhone.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Connecting to ${nameEscaped}.</Say><Dial callerId="${callerId}">${toEscaped}</Dial></Response>`;
    } catch {
      return TwilioService.CONNECT_ERROR_TWIML;
    }
  }

  /**
   * Generate a Twilio Access Token and browser connect token for WebRTC calling.
   */
  async generateBrowserToken(
    userId: string,
    leadId: string | null,
    toNumber: string | null,
    access?: { role?: string; teamId?: string | null },
    scriptPlaybookId?: string,
  ): Promise<{
    accessToken: string;
    connectToken: string;
    targetDisplay: { name: string | null; phone: string };
  }> {
    if (!this.accountSid || !this.authToken) {
      throw new BadRequestException('Twilio is not configured');
    }
    if (!this.twimlAppSid) {
      throw new BadRequestException(
        'Browser calling requires TWILIO_TWIML_APP_SID. Create a TwiML App in the Twilio Console and set this env var.',
      );
    }

    let targetPhone = '';
    let displayName: string | null = null;
    let contactId: string | null = null;

    if (leadId) {
      const lead = await this.leadsService.findOne(leadId, access) as { title?: string; primaryContact?: { id: string; phone: string | null; firstName?: string; lastName?: string } | null };
      const contact = lead.primaryContact;
      const contactPhone = contact?.phone ? normalizePhone(contact.phone) : null;
      if (!contactPhone) throw new BadRequestException('Lead has no primary contact phone number');
      targetPhone = contactPhone;
      contactId = contact?.id ?? null;
      displayName = lead.title ?? ((contact && [contact.firstName, contact.lastName].filter(Boolean).join(' ')) || null);
    } else if (toNumber) {
      const normalized = normalizePhone(toNumber);
      if (!normalized) throw new BadRequestException('Invalid phone number');
      targetPhone = normalized;
    } else {
      throw new BadRequestException('Provide leadId or toNumber');
    }

    const connectToken = this.createBrowserConnectToken(userId, leadId, leadId ? null : targetPhone);

    if (leadId) {
      await this.prisma.callRecord.create({
        data: {
          leadId,
          contactId,
          userId,
          twilioCallSid: `browser_pending_${Date.now()}`,
          direction: 'outbound',
          fromNumber: this.phoneNumber ?? '',
          toNumber: targetPhone,
          status: 'initiated',
          ...(scriptPlaybookId && { scriptPlaybookId }),
        },
      });
    }

    const { AccessToken } = (twilio as unknown as { jwt: { AccessToken: new (...args: unknown[]) => { addGrant: (g: unknown) => void; toJwt: () => string } & { VoiceGrant: new (opts: unknown) => unknown } } }).jwt;
    const { VoiceGrant } = AccessToken as unknown as { VoiceGrant: new (opts: unknown) => unknown };

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: this.twimlAppSid,
      incomingAllow: false,
    });

    const signingKey = this.apiKeySid ?? this.accountSid;
    const signingSecret = this.apiKeySecret ?? this.authToken;

    const token = new AccessToken(
      this.accountSid,
      signingKey,
      signingSecret,
      { identity: userId, ttl: CLIENT_TOKEN_TTL_S },
    );
    token.addGrant(voiceGrant);

    return {
      accessToken: token.toJwt(),
      connectToken,
      targetDisplay: { name: displayName, phone: targetPhone },
    };
  }

  /** Handle call status callback from Twilio (completed). */
  async handleCallStatus(params: {
    CallSid: string;
    CallStatus: string;
    CallDuration?: string;
  }): Promise<void> {
    const record = await this.prisma.callRecord.findUnique({
      where: { twilioCallSid: params.CallSid },
      select: { id: true, leadId: true, contactId: true, userId: true, direction: true },
    });
    if (!record) return;
    const duration = params.CallDuration ? parseInt(params.CallDuration, 10) : null;
    const durationNum = duration != null && !Number.isNaN(duration) ? duration : null;
    await this.prisma.callRecord.update({
      where: { id: record.id },
      data: {
        status: params.CallStatus,
        durationSeconds: durationNum,
        endedAt: new Date(),
        ...(params.CallStatus === 'completed' && durationNum != null && durationNum > 0 && { disposition: 'Connected' }),
      },
    });
    if (params.CallStatus !== 'completed' || !record.leadId) return;
    const activityUserId: string | null = record.userId ?? (record.leadId
      ? (await this.prisma.lead.findUnique({ where: { id: record.leadId }, select: { assignedToId: true } }))?.assignedToId ?? null
      : null);
    if (activityUserId != null) {
      await this.activitiesService.create(activityUserId, {
        leadId: record.leadId,
        contactId: record.contactId ?? undefined,
        type: 'call',
        subject: record.direction === 'inbound' ? 'Inbound call' : 'Phone call',
        metadata: {
          callSid: params.CallSid,
          duration: duration ?? 0,
          direction: record.direction,
        },
      });
    }
  }

  /**
   * Handle inbound voice webhook from Twilio: log the call (client or unknown prospect), then return TwiML.
   * Configure this URL as the "A CALL COMES IN" webhook for your Twilio number.
   */
  async handleInboundVoice(params: {
    CallSid: string;
    From: string;
    To: string;
    CallStatus?: string;
  }): Promise<string> {
    const fromNormalized = normalizePhone(params.From);
    let leadId: string | null = null;
    let contactId: string | null = null;
    if (fromNormalized) {
      const contact = await this.prisma.contact.findFirst({
        where: {
          phone: { not: null },
          OR: [
            { phone: fromNormalized },
            { phone: params.From },
            { phone: params.From.replace(/\D/g, '') },
          ],
        },
        select: { id: true },
      });
      if (contact) {
        contactId = contact.id;
        const lead = await this.prisma.lead.findFirst({
          where: { primaryContactId: contact.id, deletedAt: null },
          select: { id: true },
        });
        if (lead) leadId = lead.id;
      }
    }
    await this.prisma.callRecord.create({
      data: {
        leadId: leadId ?? undefined,
        contactId: contactId ?? undefined,
        userId: null,
        twilioCallSid: params.CallSid,
        direction: 'inbound',
        fromNumber: params.From,
        toNumber: params.To,
        status: params.CallStatus ?? 'ringing',
        startedAt: new Date(),
      },
    });
    const forwardTo = this.inboundForwardNumber ? normalizePhone(this.inboundForwardNumber) : null;
    if (forwardTo) {
      const toEscaped = forwardTo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="30">${toEscaped}</Dial></Response>`;
    }
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Thanks for calling. Please leave a message after the tone, or call back during business hours.</Say><Hangup/></Response>';
  }

  /** Default days for auto follow-up task when disposition is Follow_up or Voicemail */
  private static FOLLOW_UP_TASK_DAYS = 3;

  async getCallRecordsForLead(
    leadId: string,
    userId: string,
    role: string | undefined,
  ) {
    const where: { leadId: string; OR?: Array<{ userId: string } | { userId: { equals: null } }> } =
      role === 'admin'
        ? { leadId }
        : { leadId, OR: [{ userId }, { userId: { equals: null } }] };
    return this.prisma.callRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        scriptPlaybook: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, name: true } },
      },
    });
  }

  /** Recent inbound calls (known clients and unknown prospects). Admin sees all; others see recent inbounds. */
  async getRecentInboundCalls(userId: string, role: string | undefined, limit: number) {
    return this.prisma.callRecord.findMany({
      where: { direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        lead: { select: { id: true, title: true } },
        contact: { select: { id: true, firstName: true, lastName: true, phone: true } },
        user: { select: { id: true, name: true } },
      },
    });
  }

  async updateCallRecord(
    callRecordId: string,
    userId: string,
    role: string | undefined,
    data: {
      disposition?: string;
      outcomeScore?: number;
      notes?: string;
      sentiment?: string;
    },
  ) {
    const record = await this.prisma.callRecord.findUnique({
      where: { id: callRecordId },
      select: { id: true, userId: true, leadId: true, contactId: true },
    });
    if (!record) throw new NotFoundException('Call record not found');
    if (record.userId != null && record.userId !== userId && role !== 'admin') {
      throw new ForbiddenException('You can only update your own call records');
    }
    const updated = await this.prisma.callRecord.update({
      where: { id: callRecordId },
      data: {
        ...(data.disposition !== undefined && { disposition: data.disposition }),
        ...(data.outcomeScore !== undefined && { outcomeScore: data.outcomeScore }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.sentiment !== undefined && { sentiment: data.sentiment }),
      },
      include: {
        scriptPlaybook: { select: { id: true, name: true, slug: true } },
      },
    });
    if (
      data.disposition &&
      (data.disposition === 'Follow_up' || data.disposition === 'Voicemail') &&
      record.leadId
    ) {
      const assigneeId = record.userId ?? (await this.prisma.lead.findUnique({
        where: { id: record.leadId },
        select: { assignedToId: true },
      }))?.assignedToId;
      if (assigneeId) {
        const followUpAt = new Date();
        followUpAt.setDate(followUpAt.getDate() + TwilioService.FOLLOW_UP_TASK_DAYS);
        await this.activitiesService.create(assigneeId, {
          leadId: record.leadId,
          contactId: record.contactId ?? undefined,
          assignedToId: assigneeId,
          type: 'task',
          subject: `Follow-up call (${data.disposition.replace('_', ' ')})`,
          scheduledAt: followUpAt.toISOString(),
          reminderAt: followUpAt.toISOString(),
        });
      }
    }
    return updated;
  }

  async sendSms(
    body: string,
    opts: { leadId?: string; contactId?: string },
    userId: string,
    access?: { role?: string; teamId?: string | null },
  ): Promise<{ messageSid: string }> {
    if (!this.client || !this.phoneNumber) {
      throw new BadRequestException('SMS is not configured');
    }
    if (opts.leadId) {
      const lead = await this.leadsService.findOne(opts.leadId, access);
      const primary = lead.primaryContact as { id: string; phone: string | null; smsOptOutAt: Date | null } | null;
      if (!primary) throw new BadRequestException('Lead has no primary contact');
      if (primary.smsOptOutAt) {
        throw new BadRequestException('This contact has opted out of SMS');
      }
      const toPhone = normalizePhone(primary.phone);
      if (!toPhone) throw new BadRequestException('Lead primary contact has no phone number');
      const sent = await this.client.messages.create({
        body,
        from: this.phoneNumber,
        to: toPhone,
      });
      await this.prisma.smsMessage.create({
        data: {
          contactId: primary.id,
          leadId: opts.leadId,
          userId,
          direction: 'outbound',
          body,
          twilioMessageSid: sent.sid,
          status: sent.status ?? undefined,
          fromNumber: this.phoneNumber,
          toNumber: toPhone,
        },
      });
      await this.activitiesService.create(userId, {
        leadId: opts.leadId,
        contactId: primary.id,
        type: 'sms',
        subject: 'SMS',
        body: body.slice(0, 200),
        metadata: { twilioMessageSid: sent.sid },
      });
      return { messageSid: sent.sid };
    }
    if (opts.contactId) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: opts.contactId },
        select: { id: true, phone: true, smsOptOutAt: true },
      });
      if (!contact) throw new NotFoundException('Contact not found');
      if (contact.smsOptOutAt) {
        throw new BadRequestException('This contact has opted out of SMS');
      }
      const toPhone = normalizePhone(contact.phone);
      if (!toPhone) throw new BadRequestException('Contact has no phone number');
      const sent = await this.client.messages.create({
        body,
        from: this.phoneNumber,
        to: toPhone,
      });
      await this.prisma.smsMessage.create({
        data: {
          contactId: contact.id,
          leadId: null,
          userId,
          direction: 'outbound',
          body,
          twilioMessageSid: sent.sid,
          status: sent.status ?? undefined,
          fromNumber: this.phoneNumber,
          toNumber: toPhone,
        },
      });
      const lead = await this.prisma.lead.findFirst({
        where: { primaryContactId: contact.id, deletedAt: null },
        select: { id: true },
      });
      if (lead) {
        await this.activitiesService.create(userId, {
          leadId: lead.id,
          contactId: contact.id,
          type: 'sms',
          subject: 'SMS',
          body: body.slice(0, 200),
          metadata: { twilioMessageSid: sent.sid },
        });
      }
      return { messageSid: sent.sid };
    }
    throw new BadRequestException('Provide either leadId or contactId');
  }

  async getSmsThread(
    opts: { leadId?: string; contactId?: string },
    access?: { role?: string; teamId?: string | null },
  ): Promise<{ data: Array<{ id: string; direction: string; body: string; fromNumber: string; toNumber: string; status: string | null; createdAt: string }> }> {
    if (opts.contactId) {
      const contact = await this.prisma.contact.findFirst({ where: { id: opts.contactId } });
      if (!contact) throw new NotFoundException('Contact not found');
      const list = await this.prisma.smsMessage.findMany({
        where: { contactId: opts.contactId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, direction: true, body: true, fromNumber: true, toNumber: true, status: true, createdAt: true },
      });
      return {
        data: list.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }
    if (opts.leadId) {
      const lead = await this.leadsService.findOne(opts.leadId, access);
      const contactId = (lead.primaryContact as { id: string } | null)?.id;
      if (!contactId) {
        return { data: [] };
      }
      const list = await this.prisma.smsMessage.findMany({
        where: { contactId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, direction: true, body: true, fromNumber: true, toNumber: true, status: true, createdAt: true },
      });
      return {
        data: list.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }
    throw new BadRequestException('Provide leadId or contactId');
  }

  /** Incoming SMS webhook: find contact by From (our To = our number, From = their number). */
  async handleIncomingSms(params: {
    From: string;
    To: string;
    Body: string;
    MessageSid: string;
  }): Promise<void> {
    const fromNormalized = normalizePhone(params.From);
    if (!fromNormalized) return;
    const contact = await this.prisma.contact.findFirst({
      where: {
        phone: { not: null },
        OR: [
          { phone: fromNormalized },
          { phone: params.From },
          { phone: params.From.replace(/\D/g, '') },
        ],
      },
      select: { id: true },
    });
    if (!contact) return;
    await this.prisma.smsMessage.create({
      data: {
        contactId: contact.id,
        leadId: null,
        direction: 'inbound',
        body: params.Body,
        twilioMessageSid: params.MessageSid,
        status: 'received',
        fromNumber: params.From,
        toNumber: params.To,
      },
    });
    const lead = await this.prisma.lead.findFirst({
      where: { primaryContactId: contact.id, deletedAt: null },
      select: { id: true, assignedToId: true },
    });
    if (lead?.assignedToId) {
      await this.activitiesService.create(lead.assignedToId, {
        leadId: lead.id,
        contactId: contact.id,
        type: 'sms',
        subject: 'Inbound SMS',
        body: params.Body.slice(0, 200),
        metadata: { twilioMessageSid: params.MessageSid, direction: 'inbound' },
      });
    }
  }
}
