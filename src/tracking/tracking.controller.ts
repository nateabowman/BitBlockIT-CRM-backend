import { Controller, Get, Param, Res, Req, NotFoundException } from '@nestjs/common';
import { Response, Request } from 'express';
import { TrackingService } from './tracking.service';
import { Public } from '../common/decorators/public.decorator';

const PIXEL = Buffer.from(
  'R0lGOODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

@Controller('t')
@Public()
export class TrackingController {
  constructor(private trackingService: TrackingService) {}

  @Get('open/:token')
  async open(
    @Param('token') token: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const recorded = await this.trackingService.recordOpen(token, req.ip);
    if (!recorded) throw new NotFoundException();
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store');
    res.send(PIXEL);
  }

  @Get('c/:linkId')
  async click(
    @Param('linkId') linkId: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const url = await this.trackingService.recordClick(linkId, req.ip);
    if (!url) throw new NotFoundException();
    res.redirect(302, url);
  }
}
