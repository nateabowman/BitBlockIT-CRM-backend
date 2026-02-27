import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiService {
  constructor(private config: ConfigService) {}

  private get apiKey(): string | null {
    return this.config.get<string>('OPENAI_API_KEY') ?? null;
  }

  private get configured(): boolean {
    return !!this.apiKey;
  }

  private async callOpenAI(messages: { role: string; content: string }[], maxTokens = 500): Promise<string> {
    if (!this.configured) {
      throw new BadRequestException('AI features require OPENAI_API_KEY to be configured in environment variables.');
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new BadRequestException((err as { error?: { message?: string } }).error?.message ?? 'AI API error');
    }
    const data = await res.json() as { choices: { message: { content: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }

  async generateEmailSubjects(context: {
    contactName?: string;
    company?: string;
    leadTitle?: string;
    existingSubject?: string;
    count?: number;
  }): Promise<string[]> {
    const count = context.count ?? 5;
    const prompt = `You are an expert B2B sales copywriter specializing in IT managed services.
Generate ${count} compelling cold email subject lines for:
- Lead/Opportunity: ${context.leadTitle ?? 'IT Services Proposal'}
- Contact: ${context.contactName ?? 'a decision maker'}
- Company: ${context.company ?? 'a business'}
${context.existingSubject ? `- Improve on this existing subject: "${context.existingSubject}"` : ''}

Requirements:
- Short (under 50 chars), specific, personalized
- No clickbait, no excessive punctuation
- Mix of curiosity, value, and urgency styles
- Relevant to IT managed services, cybersecurity, or compliance

Return ONLY a JSON array of strings. Example: ["Subject 1", "Subject 2"]`;

    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 300);
    try {
      const parsed = JSON.parse(result.replace(/```json\n?|```/g, '').trim());
      return Array.isArray(parsed) ? parsed.slice(0, count) : [result];
    } catch {
      return result.split('\n').filter((s) => s.trim()).slice(0, count);
    }
  }

  async generateEmailBody(context: {
    templateType: 'cold_outreach' | 'follow_up' | 'proposal' | 'reengagement' | 'custom';
    contactName?: string;
    company?: string;
    industry?: string;
    leadTitle?: string;
    previousContext?: string;
    tone?: 'professional' | 'casual' | 'direct';
    senderName?: string;
  }): Promise<string> {
    const tone = context.tone ?? 'professional';
    const prompt = `You are an expert B2B sales copywriter for BitBlockIT, a managed IT services and cybersecurity company.

Write a ${context.templateType.replace('_', ' ')} email with a ${tone} tone.
Contact: ${context.contactName ?? 'the recipient'}
Company: ${context.company ?? 'their company'}
Industry: ${context.industry ?? 'their industry'}
Opportunity: ${context.leadTitle ?? 'IT Services'}
${context.previousContext ? `Previous context: ${context.previousContext}` : ''}
Sender: ${context.senderName ?? '[Your Name]'}

Requirements:
- 3-5 sentences max for the body
- Personalized, specific, and relevant
- Clear single call-to-action
- Include {{contactFirstName}}, {{company}}, {{assignedTo}} as variables where appropriate
- NO markdown, plain text only

Return ONLY the email body, no subject line.`;

    return this.callOpenAI([{ role: 'user', content: prompt }], 400);
  }

  async getNextBestAction(context: {
    leadTitle: string;
    stage: string;
    score: number;
    daysSinceLastActivity: number;
    lastActivityType?: string;
    lastActivityOutcome?: string;
    amount?: number;
  }): Promise<{ action: string; reason: string; urgency: 'high' | 'medium' | 'low' }> {
    const prompt = `You are a B2B sales coach for an IT managed services company.
    
Lead context:
- Title: ${context.leadTitle}
- Pipeline stage: ${context.stage}
- Lead score: ${context.score}/100
- Days since last activity: ${context.daysSinceLastActivity}
- Last activity: ${context.lastActivityType ?? 'none'} (outcome: ${context.lastActivityOutcome ?? 'unknown'})
- Deal value: ${context.amount ? `$${context.amount.toLocaleString()}` : 'not set'}

What is the single best next action for this sales rep? Return a JSON object:
{"action": "specific action to take", "reason": "brief 1-sentence explanation", "urgency": "high|medium|low"}

Be specific: "Call John at 2pm to follow up on the proposal" not "Follow up".`;

    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 200);
    try {
      return JSON.parse(result.replace(/```json\n?|```/g, '').trim());
    } catch {
      return { action: result, reason: 'AI recommendation', urgency: 'medium' };
    }
  }

  async chat(messages: { role: 'user' | 'assistant'; content: string }[], systemContext?: string): Promise<string> {
    const systemMessage = systemContext ?? `You are a helpful CRM assistant for BitBlockIT, an IT managed services company. 
You help sales reps with leads, activities, pipeline management, and sales coaching.
Be concise, actionable, and specific. If you need data you don't have, say so.`;

    return this.callOpenAI(
      [{ role: 'system', content: systemMessage }, ...messages],
      600
    );
  }

  async classifyEmailReply(emailBody: string): Promise<{
    category: 'interested' | 'not_interested' | 'meeting_request' | 'objection' | 'out_of_office' | 'other';
    confidence: number;
    suggestedResponse?: string;
  }> {
    const prompt = `Classify this email reply from a prospect:

"${emailBody.slice(0, 500)}"

Return JSON: {"category": "interested|not_interested|meeting_request|objection|out_of_office|other", "confidence": 0-100, "suggestedResponse": "optional 1-2 sentence reply suggestion"}`;

    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 300);
    try {
      return JSON.parse(result.replace(/```json\n?|```/g, '').trim());
    } catch {
      return { category: 'other', confidence: 50 };
    }
  }

  async summarizeCallNotes(notes: string): Promise<{
    summary: string;
    keyPoints: string[];
    nextSteps: string[];
    sentiment: 'positive' | 'neutral' | 'negative';
  }> {
    const prompt = `Analyze these sales call notes and extract structured information:

"${notes.slice(0, 1000)}"

Return JSON:
{
  "summary": "2-3 sentence summary",
  "keyPoints": ["key point 1", "key point 2"],
  "nextSteps": ["action item 1", "action item 2"],
  "sentiment": "positive|neutral|negative"
}`;

    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 400);
    try {
      return JSON.parse(result.replace(/```json\n?|```/g, '').trim());
    } catch {
      return { summary: notes.slice(0, 100), keyPoints: [], nextSteps: [], sentiment: 'neutral' };
    }
  }

  async detectPersona(context: {
    jobTitle?: string;
    department?: string;
    companySize?: string;
    industry?: string;
    recentActivities?: string[];
  }): Promise<{
    persona: 'decision_maker' | 'influencer' | 'technical_buyer' | 'end_user' | 'unknown';
    confidence: number;
    reasoning: string;
    suggestedApproach: string;
  }> {
    const prompt = `Classify this B2B contact's buying persona based on available context.

Contact context:
- Job title: ${context.jobTitle ?? 'unknown'}
- Department: ${context.department ?? 'unknown'}
- Company size: ${context.companySize ?? 'unknown'}
- Industry: ${context.industry ?? 'unknown'}
- Recent interactions: ${context.recentActivities?.join(', ') ?? 'none'}

Classify as ONE of: decision_maker, influencer, technical_buyer, end_user, unknown

Return JSON: {"persona": "...", "confidence": 0-100, "reasoning": "brief explanation", "suggestedApproach": "1-2 sentence sales approach"}`;

    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 250);
    try {
      return JSON.parse(result.replace(/```json\n?|```/g, '').trim());
    } catch {
      return { persona: 'unknown', confidence: 0, reasoning: result, suggestedApproach: 'Use a consultative approach.' };
    }
  }

  async getChurnPredictionAlerts(leads: {
    id: string;
    title: string;
    daysSinceActivity: number;
    score: number;
    daysInStage: number;
    amount?: number;
  }[]): Promise<{ leadId: string; riskLevel: 'high' | 'medium'; reason: string; suggestedAction: string }[]> {
    const atRisk = leads.filter((l) =>
      l.daysSinceActivity > 21 || l.score < 30 || l.daysInStage > 30
    ).slice(0, 10);

    if (atRisk.length === 0) return [];

    const prompt = `Analyze these at-risk CRM leads and provide churn risk alerts.

Leads:
${atRisk.map((l) => `- ID:${l.id} "${l.title}" | ${l.daysSinceActivity}d since activity | Score:${l.score} | ${l.daysInStage}d in stage${l.amount ? ` | $${l.amount}` : ''}`).join('\n')}

For each lead, identify the risk level and suggest ONE specific action.
Return JSON array: [{"leadId": "...", "riskLevel": "high|medium", "reason": "brief reason", "suggestedAction": "specific action"}]`;

    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 600);
    try {
      return JSON.parse(result.replace(/```json\n?|```/g, '').trim());
    } catch {
      return atRisk.map((l) => ({
        leadId: l.id,
        riskLevel: l.daysSinceActivity > 30 ? 'high' : 'medium',
        reason: `No activity in ${l.daysSinceActivity} days`,
        suggestedAction: 'Schedule a check-in call',
      }));
    }
  }

  async repCoachingInsights(repData: {
    name: string;
    winRate: number;
    avgDealSize: number;
    activityCount: number;
    avgDaysToClose: number;
    period?: string;
  }): Promise<{
    strengths: string[];
    improvements: string[];
    weeklyFocus: string;
    motivationalNote: string;
  }> {
    const prompt = `You are a B2B sales coach for an IT managed services company.

Rep performance data for ${repData.name} (${repData.period ?? 'last 30 days'}):
- Win rate: ${repData.winRate}%
- Average deal size: $${repData.avgDealSize.toLocaleString()}
- Activities completed: ${repData.activityCount}
- Avg. days to close: ${repData.avgDaysToClose}

Provide personalized coaching insights. Return JSON:
{
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["area 1", "area 2"],
  "weeklyFocus": "one specific focus for this week",
  "motivationalNote": "brief motivational message"
}`;

    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 400);
    try {
      return JSON.parse(result.replace(/```json\n?|```/g, '').trim());
    } catch {
      return {
        strengths: ['Consistent activity logging'],
        improvements: ['Increase follow-up cadence'],
        weeklyFocus: 'Focus on moving deals past the proposal stage',
        motivationalNote: 'Keep going — every call is a step closer to the win!',
      };
    }
  }

  async predictiveLeadRouting(data: {
    leadTitle: string; company?: string; source?: string; industry?: string; score?: number;
    reps: { id: string; name: string; currentLoad: number; avgWinRate: number; specialties: string[] }[];
  }): Promise<{ repId: string; repName: string; confidence: number; reasoning: string }> {
    const repsText = data.reps.map((r) => `${r.name}: load=${r.currentLoad} deals, winRate=${r.avgWinRate}%, specialties=[${r.specialties.join(', ')}]`).join('\n');
    const prompt = `You are a sales ops AI for BitBlockIT (IT managed services company).

Route this new lead to the best rep:
Lead: "${data.leadTitle}"
Company: ${data.company ?? 'Unknown'}
Source: ${data.source ?? 'Unknown'}
Industry: ${data.industry ?? 'Unknown'}
Score: ${data.score ?? 'N/A'}

Available reps:
${repsText}

Choose the best rep considering: specialties match, current workload, win rate.
Return JSON: {"repId": "id", "repName": "name", "confidence": 0-100, "reasoning": "1 sentence"}`;

    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 200);
    try {
      const parsed = JSON.parse(result.replace(/```json\n?|```/g, '').trim());
      return parsed;
    } catch {
      const firstRep = data.reps[0];
      return { repId: firstRep?.id ?? '', repName: firstRep?.name ?? 'Unknown', confidence: 50, reasoning: 'Assigned to first available rep' };
    }
  }

  async recommendTags(context: { title: string; notes?: string; company?: string; source?: string; existingTags?: string[] }): Promise<string[]> {
    const prompt = `Suggest 3-5 CRM tags for this sales lead at BitBlockIT (IT managed services).

Lead title: ${context.title}
Company: ${context.company ?? 'Unknown'}
Source: ${context.source ?? 'Unknown'}
Notes: ${context.notes?.slice(0, 200) ?? 'None'}
Already has tags: ${context.existingTags?.join(', ') ?? 'None'}

Return ONLY a JSON array of short tag names (max 2 words each). Example: ["Enterprise", "HIPAA", "Follow-up"]`;
    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 150);
    try { return JSON.parse(result.replace(/```json\n?|```/g, '').trim()); } catch { return result.split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean).slice(0, 5); }
  }

  async parseMeetingNotes(notes: string, attendees?: string[], date?: string): Promise<{
    summary: string;
    actionItems: { owner: string; action: string; dueDate?: string }[];
    keyTopics: string[];
    nextMeetingDate?: string;
    decisions: string[];
  }> {
    const prompt = `Parse these meeting notes and extract structured information.

Date: ${date ?? 'Unknown'}
Attendees: ${attendees?.join(', ') ?? 'Unknown'}
Notes:
${notes.slice(0, 1500)}

Return JSON:
{
  "summary": "2-3 sentence summary",
  "actionItems": [{"owner": "name", "action": "task", "dueDate": "date or null"}],
  "keyTopics": ["topic1", "topic2"],
  "nextMeetingDate": "date or null",
  "decisions": ["decision1"]
}`;
    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 500);
    try { return JSON.parse(result.replace(/```json\n?|```/g, '').trim()); }
    catch { return { summary: notes.slice(0, 100), actionItems: [], keyTopics: [], nextMeetingDate: undefined, decisions: [] }; }
  }

  async optimizeSequence(data: {
    sequenceName: string;
    steps: { type: string; subject?: string; openRate?: number; clickRate?: number; delayDays: number }[];
  }): Promise<{ recommendations: { step: number; suggestion: string; priority: 'high' | 'medium' | 'low' }[]; overallScore: number; summary: string }> {
    const stepsText = data.steps.map((s, i) => `Step ${i + 1}: ${s.type} "${s.subject ?? 'N/A'}" | Delay: ${s.delayDays}d | Open: ${s.openRate ?? '?'}% | Click: ${s.clickRate ?? '?'}%`).join('\n');
    const prompt = `You are an email sequence optimization expert for B2B IT sales.

Sequence: ${data.sequenceName}
Steps:
${stepsText}

Analyze and provide optimization recommendations. Return JSON:
{
  "recommendations": [{"step": 1, "suggestion": "specific change", "priority": "high|medium|low"}],
  "overallScore": 0-100,
  "summary": "2-3 sentence assessment"
}`;
    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 400);
    try { return JSON.parse(result.replace(/```json\n?|```/g, '').trim()); }
    catch { return { recommendations: [], overallScore: 50, summary: result }; }
  }

  async scriptCoach(currentText: string, stage: string, persona?: string): Promise<{ feedback: string; improvements: string[]; alternativeScript?: string }> {
    const prompt = `You are a real-time sales script coach for BitBlockIT (IT managed services company).

The rep is in stage: ${stage}
Persona: ${persona ?? 'Decision Maker'}
Current script text:
"${currentText.slice(0, 500)}"

Provide immediate coaching. Return JSON:
{
  "feedback": "brief coaching feedback",
  "improvements": ["specific improvement 1", "specific improvement 2"],
  "alternativeScript": "optional improved version"
}`;
    const result = await this.callOpenAI([{ role: 'user', content: prompt }], 400);
    try { return JSON.parse(result.replace(/```json\n?|```/g, '').trim()); }
    catch { return { feedback: result, improvements: [] }; }
  }

  getStatus() {
    return {
      configured: this.configured,
      model: 'gpt-4o-mini',
      message: this.configured
        ? 'AI features are available'
        : 'Set OPENAI_API_KEY in environment variables to enable AI features',
    };
  }
}
