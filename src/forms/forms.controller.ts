import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Res, Req, Query } from '@nestjs/common';
import { Response, Request } from 'express';
import { FormsService } from './forms.service';
import { SubmitFormDto } from './dto/submit-form.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';

@Controller('forms')
export class FormsController {
  constructor(
    private formsService: FormsService,
    private config: ConfigService,
  ) {}

  @Public()
  @Get('embed-script')
  async embedScript(@Req() req: Request, @Res() res: Response, @Param('formId') _formId?: string) {
    const formId = (req as { query?: { formId?: string } }).query?.formId;
    if (!formId) {
      return res.status(400).send('formId required');
    }
    const base = this.config.get('API_PUBLIC_URL') || (req.headers['x-forwarded-host'] ? `https://${req.headers['x-forwarded-host']}` : 'http://localhost:3001');
    const apiBase = `${String(base).replace(/\/$/, '')}/api/v1`;
    const iframeUrl = `${apiBase}/forms/f/${formId}`;
    const script = `(function(){var d=document,w=window;var i=d.createElement('iframe');i.src="${iframeUrl}";i.width='100%';i.height=400;i.frameBorder=0;i.title='Form';var c=d.getElementById('bb-form-${formId}')||d.body;c.appendChild(i);})();`;
    res.setHeader('Content-Type', 'application/javascript');
    res.send(script);
  }

  @Public()
  @Get('lp/:slug')
  async landingPage(@Param('slug') slug: string, @Res() res: Response) {
    const html = await this.formsService.renderLandingPageHtml(slug);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  @Public()
  @Get('f/:formId')
  async formView(@Param('formId') formId: string, @Res() res: Response) {
    const form = await this.formsService.findOne(formId);
    const base = this.config.get('API_PUBLIC_URL') || 'http://localhost:3001';
    const apiBase = `${base.replace(/\/$/, '')}/api/v1`;
    const fields = ((form.schema as { fields?: Array<{ key: string; label?: string; type?: string }> })?.fields ?? []);
    const formHtml = fields
      .map(
        (f) =>
          `<p><label>${f.label ?? f.key}</label><br><input type="${f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : 'text'}" name="${f.key}" ${f.key === 'email' || f.key === 'Email' ? 'required' : ''}></p>`,
      )
      .join('\n');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${form.name}</title></head><body><form id="f" action="${apiBase}/forms/${form.id}/submit" method="post"><input type="hidden" name="data" value="{}"><div id="fields">${formHtml}</div><button type="submit">Submit</button></form><script>
(function(){
  var form = document.getElementById('f');
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var fd = new FormData(form);
    var data = {};
    fd.forEach(function(v,k) { if (k !== 'data') data[k] = v; });
    form.querySelector('input[name="data"]').value = JSON.stringify(data);
    fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: data, email: data.email || data.Email, name: data.name || data.Name, company: data.company || data.Company, visitorId: (document.cookie.match(/bb_visitor_id=([^;]+)/)||[])[1] }) })
      .then(function(r) { return r.json(); })
      .then(function(j) { if (j.data && j.data.thankYouUrl) window.top.location = j.data.thankYouUrl; else alert('Thank you!'); })
      .catch(function() { alert('Error'); });
  });
})();
</script></body></html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  @Get(':id/embed')
  @UseGuards(JwtAuthGuard)
  async getEmbed(@Param('id') id: string) {
    const data = await this.formsService.getEmbedSnippet(id);
    return { data };
  }

  @Public()
  @Get('confirm')
  async confirm(@Query('token') token: string, @Res() res: Response) {
    if (!token?.trim()) {
      return res.status(400).send('Token required');
    }
    try {
      const { redirectUrl } = await this.formsService.confirmToken(token.trim());
      return res.redirect(302, redirectUrl);
    } catch {
      return res.status(404).send('Invalid or expired confirmation link');
    }
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(':id/submit')
  async submit(
    @Param('id') id: string,
    @Body() dto: SubmitFormDto,
    @Req() req: Request,
  ) {
    const ip = (req as { ip?: string }).ip ?? req.socket?.remoteAddress ?? undefined;
    const userAgent = req.get('user-agent') ?? undefined;
    const origin = req.get('Origin') ?? req.get('Referer') ?? undefined;
    const data = await this.formsService.submit(id, dto, { ip, userAgent, origin });
    return { data };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll() {
    const data = await this.formsService.findAll();
    return { data };
  }

  @Get('slug/:slug')
  @UseGuards(JwtAuthGuard)
  async findBySlug(@Param('slug') slug: string) {
    const data = await this.formsService.findOneBySlug(slug);
    return { data };
  }

  @Get(':id/submissions')
  @UseGuards(JwtAuthGuard)
  async getSubmissions(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('format') format?: string,
    @Res() res?: Response,
  ) {
    const result = await this.formsService.getSubmissions(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
      format === 'csv' ? 'csv' : 'json',
    );
    if (format === 'csv' && result.contentType && res) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="form-${id}-submissions.csv"`);
      return res.send((result as { data: string }).data);
    }
    return { data: (result as { data: { items: unknown[]; total: number; page: number; limit: number } }).data };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string) {
    const data = await this.formsService.findOne(id);
    return { data };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Body()
    body: {
      name: string;
      schema: object;
      segmentId?: string;
      sequenceId?: string;
      thankYouUrl?: string;
      requireConfirmation?: boolean;
      confirmRedirectUrl?: string;
    },
  ) {
    const data = await this.formsService.create(body);
    return { data };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      schema?: object;
      segmentId?: string | null;
      sequenceId?: string | null;
      thankYouUrl?: string | null;
      webhookUrl?: string | null;
      tagIds?: string[] | null;
      embedAllowlist?: string[] | null;
      progressiveConfig?: object | null;
      requireConfirmation?: boolean | null;
      confirmRedirectUrl?: string | null;
    },
  ) {
    const data = await this.formsService.update(id, body);
    return { data };
  }

  @Post(':id/landing-pages')
  @UseGuards(JwtAuthGuard)
  async createLandingPage(
    @Param('id') id: string,
    @Body() body: { slug: string; title: string; body?: string | null },
  ) {
    const data = await this.formsService.createLandingPage(id, body);
    return { data };
  }

  @Patch(':formId/landing-pages/:lpId')
  @UseGuards(JwtAuthGuard)
  async updateLandingPage(
    @Param('formId') formId: string,
    @Param('lpId') lpId: string,
    @Body() body: { slug?: string; title?: string; body?: string | null },
  ) {
    const data = await this.formsService.updateLandingPage(formId, lpId, body);
    return { data };
  }

  @Delete(':formId/landing-pages/:lpId')
  @UseGuards(JwtAuthGuard)
  async removeLandingPage(@Param('formId') formId: string, @Param('lpId') lpId: string) {
    const result = await this.formsService.removeLandingPage(formId, lpId);
    return result;
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.formsService.remove(id);
  }
}
