import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AiService } from './ai.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private service: AiService) {}

  @Get('status')
  status() {
    return this.service.getStatus();
  }

  @Post('email-subjects')
  async emailSubjects(@Body() body: {
    contactName?: string;
    company?: string;
    leadTitle?: string;
    existingSubject?: string;
    count?: number;
  }) {
    return { data: await this.service.generateEmailSubjects(body) };
  }

  @Post('email-body')
  async emailBody(@Body() body: {
    templateType: 'cold_outreach' | 'follow_up' | 'proposal' | 'reengagement' | 'custom';
    contactName?: string;
    company?: string;
    industry?: string;
    leadTitle?: string;
    previousContext?: string;
    tone?: 'professional' | 'casual' | 'direct';
    senderName?: string;
  }) {
    return { data: await this.service.generateEmailBody(body) };
  }

  @Post('next-best-action')
  async nextBestAction(@Body() body: {
    leadTitle: string;
    stage: string;
    score: number;
    daysSinceLastActivity: number;
    lastActivityType?: string;
    lastActivityOutcome?: string;
    amount?: number;
  }) {
    return { data: await this.service.getNextBestAction(body) };
  }

  @Post('chat')
  async chat(@Body() body: {
    messages: { role: 'user' | 'assistant'; content: string }[];
    systemContext?: string;
  }) {
    return { data: await this.service.chat(body.messages, body.systemContext) };
  }

  @Post('classify-reply')
  async classifyReply(@Body() body: { emailBody: string }) {
    return { data: await this.service.classifyEmailReply(body.emailBody) };
  }

  @Post('summarize-call')
  async summarizeCall(@Body() body: { notes: string }) {
    return { data: await this.service.summarizeCallNotes(body.notes) };
  }

  @Post('detect-persona')
  async detectPersona(@Body() body: {
    jobTitle?: string;
    department?: string;
    companySize?: string;
    industry?: string;
    recentActivities?: string[];
  }) {
    return { data: await this.service.detectPersona(body) };
  }

  @Post('churn-alerts')
  async churnAlerts(@Body() body: { leads: { id: string; title: string; daysSinceActivity: number; score: number; daysInStage: number; amount?: number }[] }) {
    return { data: await this.service.getChurnPredictionAlerts(body.leads) };
  }

  @Post('rep-coaching')
  async repCoaching(@Body() body: { name: string; winRate: number; avgDealSize: number; activityCount: number; avgDaysToClose: number; period?: string }) {
    return { data: await this.service.repCoachingInsights(body) };
  }

  @Post('recommend-tags')
  async recommendTags(@Body() body: { title: string; notes?: string; company?: string; source?: string; existingTags?: string[] }) {
    return { data: await this.service.recommendTags(body) };
  }

  @Post('parse-meeting-notes')
  async parseMeetingNotes(@Body() body: { notes: string; attendees?: string[]; date?: string }) {
    return { data: await this.service.parseMeetingNotes(body.notes, body.attendees, body.date) };
  }

  @Post('optimize-sequence')
  async optimizeSequence(@Body() body: { sequenceName: string; steps: { type: string; subject?: string; openRate?: number; clickRate?: number; delayDays: number }[] }) {
    return { data: await this.service.optimizeSequence(body) };
  }

  @Post('script-coach')
  async scriptCoach(@Body() body: { currentText: string; stage: string; persona?: string }) {
    return { data: await this.service.scriptCoach(body.currentText, body.stage, body.persona) };
  }

  @Post('route-lead')
  async routeLead(@Body() body: {
    leadTitle: string; company?: string; source?: string; industry?: string; score?: number;
    reps: { id: string; name: string; currentLoad: number; avgWinRate: number; specialties: string[] }[];
  }) {
    return { data: await this.service.predictiveLeadRouting(body) };
  }
}
