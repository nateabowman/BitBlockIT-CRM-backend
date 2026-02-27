import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', description: 'Full CRM access' },
  });

  const superAdminRole = await prisma.role.upsert({
    where: { name: 'super-admin' },
    update: {},
    create: { name: 'super-admin', description: 'Full access including admin panel' },
  });

  const permissions = [
    { resource: 'lead', action: 'read' },
    { resource: 'lead', action: 'write' },
    { resource: 'organization', action: 'read' },
    { resource: 'organization', action: 'write' },
    { resource: 'contact', action: 'read' },
    { resource: 'contact', action: 'write' },
    { resource: 'report', action: 'read' },
    { resource: 'user', action: 'read' },
    { resource: 'user', action: 'write' },
    { resource: 'settings', action: 'read' },
    { resource: 'settings', action: 'write' },
    { resource: 'team', action: 'read' },
    { resource: 'team', action: 'write' },
    { resource: 'pipeline', action: 'read' },
    { resource: 'pipeline', action: 'write' },
    { resource: 'audit', action: 'read' },
    { resource: 'activity', action: 'read' },
    { resource: 'activity', action: 'write' },
  ];
  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { resource_action: { resource: p.resource, action: p.action } },
      update: {},
      create: p,
    });
  }

  const perms = await prisma.permission.findMany();
  for (const perm of perms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    });
    // super-admin gets every permission too
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: superAdminRole.id, permissionId: perm.id },
    });
  }

  // salesperson role (mirrors sales_rep with user-friendly name)
  const salespersonRole = await prisma.role.upsert({
    where: { name: 'salesperson' },
    update: {},
    create: { name: 'salesperson', description: 'Outbound sales: leads, contacts, calls, SMS, email' },
  });
  const salesRepPermResources2 = ['lead', 'contact', 'organization', 'activity', 'pipeline', 'report'];
  for (const resource of salesRepPermResources2) {
    const readP = perms.find((perm) => perm.resource === resource && perm.action === 'read');
    if (readP) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: salespersonRole.id, permissionId: readP.id } },
        update: {},
        create: { roleId: salespersonRole.id, permissionId: readP.id },
      });
    }
    if (resource === 'lead' || resource === 'contact' || resource === 'activity') {
      const writeP = perms.find((perm) => perm.resource === resource && perm.action === 'write');
      if (writeP) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: salespersonRole.id, permissionId: writeP.id } },
          update: {},
          create: { roleId: salespersonRole.id, permissionId: writeP.id },
        });
      }
    }
  }

  // read-only role (mirrors viewer with user-friendly name)
  const readOnlyRole = await prisma.role.upsert({
    where: { name: 'read-only' },
    update: {},
    create: { name: 'read-only', description: 'Read-only access to all CRM data' },
  });
  const readOnlyPerms = perms.filter((perm) => perm.action === 'read');
  for (const perm of readOnlyPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: readOnlyRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: readOnlyRole.id, permissionId: perm.id },
    });
  }

  const salesManagerRole = await prisma.role.upsert({
    where: { name: 'sales_manager' },
    update: {},
    create: { name: 'sales_manager', description: 'Sees and edits team leads only' },
  });
  const readPerms = perms.filter((p) => p.action === 'read');
  for (const perm of readPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: salesManagerRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: salesManagerRole.id, permissionId: perm.id },
    });
  }
  const leadWrite = perms.find((p) => p.resource === 'lead' && p.action === 'write');
  if (leadWrite) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: salesManagerRole.id, permissionId: leadWrite.id } },
      update: {},
      create: { roleId: salesManagerRole.id, permissionId: leadWrite.id },
    });
  }

  const viewerRole = await prisma.role.upsert({
    where: { name: 'viewer' },
    update: {},
    create: { name: 'viewer', description: 'Read-only access' },
  });
  for (const perm of readPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: viewerRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: viewerRole.id, permissionId: perm.id },
    });
  }

  // Sales rep / cold caller: full lead/contact/activity access, no user/settings write; sees all leads (no team filter)
  const salesRepRole = await prisma.role.upsert({
    where: { name: 'sales_rep' },
    update: {},
    create: { name: 'sales_rep', description: 'Outbound sales: leads, contacts, calls, SMS, email' },
  });
  const salesRepPermResources = ['lead', 'contact', 'organization', 'activity', 'pipeline', 'report'];
  for (const resource of salesRepPermResources) {
    const readP = perms.find((p) => p.resource === resource && p.action === 'read');
    if (readP) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: salesRepRole.id, permissionId: readP.id } },
        update: {},
        create: { roleId: salesRepRole.id, permissionId: readP.id },
      });
    }
    if (resource === 'lead' || resource === 'contact' || resource === 'activity') {
      const writeP = perms.find((p) => p.resource === resource && p.action === 'write');
      if (writeP) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: salesRepRole.id, permissionId: writeP.id } },
          update: {},
          create: { roleId: salesRepRole.id, permissionId: writeP.id },
        });
      }
    }
    if (resource === 'pipeline') {
      const writeP = perms.find((p) => p.resource === 'pipeline' && p.action === 'write');
      if (writeP) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: salesRepRole.id, permissionId: writeP.id } },
          update: {},
          create: { roleId: salesRepRole.id, permissionId: writeP.id },
        });
      }
    }
  }

  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@bitblockit.com' },
    update: { passwordHash, roleId: superAdminRole.id },
    create: {
      email: 'admin@bitblockit.com',
      passwordHash,
      name: 'Admin',
      roleId: superAdminRole.id,
    },
  });

  let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } });
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: { name: 'Sales Pipeline', type: 'lead', isDefault: true },
    });
  }

  const stages = [
    { name: 'New', order: 0, color: '#94a3b8' },
    { name: 'Contacted', order: 1, color: '#60a5fa' },
    { name: 'Qualified', order: 2, color: '#a78bfa' },
    { name: 'Proposal', order: 3, color: '#f59e0b' },
    { name: 'Won', order: 4, color: '#22c55e', isWon: true },
    { name: 'Lost', order: 5, color: '#ef4444', isLost: true },
  ];
  const existingStages = await prisma.pipelineStage.count({ where: { pipelineId: pipeline.id } });
  if (existingStages === 0) {
    await prisma.pipelineStage.createMany({
      data: stages.map((s) => ({
        pipelineId: pipeline!.id,
        name: s.name,
        order: s.order,
        color: s.color,
        isWon: (s as { isWon?: boolean }).isWon ?? false,
        isLost: (s as { isLost?: boolean }).isLost ?? false,
      })),
    });
  }

  // Phase A: tags and option lists
  const tagNames = ['Hot', 'Follow-up', 'Enterprise', 'Trial'];
  for (const name of tagNames) {
    await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  const sourceOptions = [
    { value: 'website', label: 'Website' },
    { value: 'referral', label: 'Referral' },
    { value: 'cold_outreach', label: 'Cold outreach' },
    { value: 'event', label: 'Event' },
    { value: 'partner', label: 'Partner' },
  ];
  for (let i = 0; i < sourceOptions.length; i++) {
    const { value, label } = sourceOptions[i];
    const existing = await prisma.optionList.findFirst({ where: { type: 'source', value } });
    if (!existing) {
      await prisma.optionList.create({
        data: { type: 'source', value, label, order: i },
      });
    }
  }
  const lostReasons = [
    { value: 'budget', label: 'Budget' },
    { value: 'timing', label: 'Timing' },
    { value: 'competitor', label: 'Went with competitor' },
    { value: 'no_response', label: 'No response' },
  ];
  const lostStage = await prisma.pipelineStage.findFirst({ where: { pipelineId: pipeline.id, isLost: true } });
  for (let i = 0; i < lostReasons.length; i++) {
    const { value, label } = lostReasons[i];
    const existing = await prisma.optionList.findFirst({
      where: { type: 'lost_reason', value, pipelineId: lostStage?.id ?? undefined },
    });
    if (!existing) {
      await prisma.optionList.create({
        data: { type: 'lost_reason', value, label, pipelineId: lostStage?.id ?? null, order: i },
      });
    }
  }

  // Outbound email templates (cold outreach / sales)
  const outboundTemplates = [
    {
      name: 'Cold outreach – intro',
      subject: 'Quick intro – {{company}}',
      bodyHtml:
        '<p>Hi {{contactFirstName}},</p><p>I wanted to reach out about how we help companies like {{company}}.</p><p>Would you be open to a short call this week?</p><p>Best,<br>{{assignedTo}}</p>',
      bodyText:
        'Hi {{contactFirstName}},\n\nI wanted to reach out about how we help companies like {{company}}.\n\nWould you be open to a short call this week?\n\nBest,\n{{assignedTo}}',
      category: 'outbound',
    },
    {
      name: 'Follow-up after call',
      subject: 'Following up – {{company}}',
      bodyHtml:
        '<p>Hi {{contactFirstName}},</p><p>Thanks for taking the time to chat. As discussed, here’s a quick recap and next steps.</p><p>If you have any questions, reply to this email or book a time: {{scheduleMeetingUrl}}</p><p>Best,<br>{{assignedTo}}</p>',
      bodyText:
        'Hi {{contactFirstName}},\n\nThanks for taking the time to chat. As discussed, here\'s a quick recap and next steps.\n\nIf you have any questions, reply to this email or book a time: {{scheduleMeetingUrl}}\n\nBest,\n{{assignedTo}}',
      category: 'outbound',
    },
    {
      name: 'Meeting request',
      subject: 'Schedule a call – {{company}}',
      bodyHtml:
        '<p>Hi {{contactFirstName}},</p><p>I’d like to set up a brief call to discuss how we can help {{company}}.</p><p>You can pick a time that works here: {{scheduleMeetingUrl}}</p><p>Best,<br>{{assignedTo}}</p>',
      bodyText:
        'Hi {{contactFirstName}},\n\nI\'d like to set up a brief call to discuss how we can help {{company}}.\n\nYou can pick a time that works here: {{scheduleMeetingUrl}}\n\nBest,\n{{assignedTo}}',
      category: 'outbound',
    },
  ];
  for (const t of outboundTemplates) {
    const existing = await prisma.emailTemplate.findFirst({ where: { name: t.name } });
    if (!existing) {
      await prisma.emailTemplate.create({
        data: {
          name: t.name,
          subject: t.subject,
          bodyHtml: t.bodyHtml,
          bodyText: t.bodyText,
          category: t.category,
        },
      });
    }
  }

  // MSP outbound sequences: additional templates (variable-aware)
  const mspTemplates = [
    {
      name: 'Cold prospect – intro',
      subject: 'Quick intro – {{company}}',
      bodyHtml:
        '<p>Hi {{contactFirstName}},</p><p>I help {{industry}} companies like {{company}} reduce IT risk and stay compliant without the break-fix headache.</p><p>Would you be open to a 15-minute call to see if we’re a fit?</p><p>Best,<br>{{assignedTo}}</p>',
      category: 'outbound_sales',
    },
    {
      name: 'Compliance risk alert',
      subject: '{{company}} – compliance readiness',
      bodyHtml:
        '<p>Hi {{contactFirstName}},</p><p>Many {{industry}} teams are tightening up before their next audit. I wanted to share a short checklist we use with companies like {{company}}.</p><p>Want to run through it on a quick call?</p><p>Best,<br>{{assignedTo}}</p>',
      category: 'outbound_sales',
    },
    {
      name: 'Ransomware awareness',
      subject: 'Quick question about {{company}} backups',
      bodyHtml:
        '<p>Hi {{contactFirstName}},</p><p>We’re seeing more {{industry}} firms hit by ransomware. I’m not selling fear—just offering a no-cost backup and recovery snapshot for {{company}}.</p><p>Interested in a 10-minute review?</p><p>Best,<br>{{assignedTo}}</p>',
      category: 'outbound_sales',
    },
    {
      name: 'Post-call follow-up recap',
      subject: 'Following up – {{company}}',
      bodyHtml:
        '<p>Hi {{contactFirstName}},</p><p>Thanks for taking the time to chat. Here’s a quick recap and next steps.</p><p>If you have questions, reply to this email or book time: {{scheduleMeetingUrl}}</p><p>Best,<br>{{assignedTo}}</p>',
      category: 'outbound_sales',
    },
    {
      name: 'Proposal follow-up',
      subject: 'Re: proposal for {{company}}',
      bodyHtml:
        '<p>Hi {{contactFirstName}},</p><p>I wanted to follow up on the proposal we sent. Do you have a few minutes this week to discuss or answer any questions?</p><p>Best,<br>{{assignedTo}}</p>',
      category: 'outbound_sales',
    },
  ];
  for (const t of mspTemplates) {
    const existing = await prisma.emailTemplate.findFirst({ where: { name: t.name } });
    if (!existing) {
      await prisma.emailTemplate.create({
        data: {
          name: t.name,
          subject: t.subject,
          bodyHtml: t.bodyHtml,
          bodyText: t.bodyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
          category: t.category,
        },
      });
    }
  }

  // Example sequence: Cold Prospect (3-step example; extend to 5 touches in admin)
  const coldIntro = await prisma.emailTemplate.findFirst({ where: { name: 'Cold prospect – intro' } });
  if (coldIntro) {
    const existingSeq = await prisma.sequence.findFirst({ where: { name: 'Cold Prospect (example)' } });
    if (!existingSeq) {
      const seq = await prisma.sequence.create({ data: { name: 'Cold Prospect (example)' } });
      await prisma.sequenceStep.createMany({
        data: [
          { sequenceId: seq.id, order: 0, type: 'email', templateId: coldIntro.id, delayMinutes: 0 },
          { sequenceId: seq.id, order: 1, type: 'delay', templateId: null, delayMinutes: 3 * 24 * 60 },
          { sequenceId: seq.id, order: 2, type: 'email', templateId: coldIntro.id, delayMinutes: 0 },
          { sequenceId: seq.id, order: 3, type: 'delay', templateId: null, delayMinutes: 5 * 24 * 60 },
          { sequenceId: seq.id, order: 4, type: 'email', templateId: coldIntro.id, delayMinutes: 0 },
        ],
      });
    }
  }

  // Phase B: activity types (call and sms used by Twilio integration)
  const activityTypes = [
    { name: 'Call', slug: 'call', isTask: false, order: 0 },
    { name: 'Email', slug: 'email', isTask: false, order: 1 },
    { name: 'Meeting', slug: 'meeting', isTask: false, order: 2 },
    { name: 'Note', slug: 'note', isTask: false, order: 3 },
    { name: 'SMS', slug: 'sms', isTask: false, order: 4 },
    { name: 'Task', slug: 'task', isTask: true, order: 5 },
  ];
  for (const at of activityTypes) {
    await prisma.activityType.upsert({
      where: { slug: at.slug },
      update: {},
      create: at,
    });
  }

  // Sales playbooks (MSP scripts with objection handling, BANT, closes, pacing)
  const playbooks = [
    {
      slug: 'default',
      name: 'Default MSP Script',
      description: 'General consultative script for any prospect.',
      payload: {
        intro: {
          lines: [
            'Hi, this is [Your Name] from BitBlockIT. I help businesses like {{CompanyName}} reduce IT risk and stay compliant.',
            'Do you have 2 minutes to talk about how we support companies in {{Industry}}?',
          ],
          variables: ['CompanyName', 'Industry'],
        },
        painDiscovery: {
          questions: [
            'What’s the biggest IT or security concern on your mind right now?',
            'How are you currently handling backups and disaster recovery?',
            'When something goes wrong, how quickly does your team get support?',
          ],
          variables: [],
        },
        objectionHandling: {
          layers: [
            { objection: 'We’re fine with our current setup.', response: 'A lot of teams feel that way until something breaks or a compliance audit comes up. Would it help to see how your setup compares to peers in {{Industry}}?' },
            { objection: 'We have internal IT.', response: 'That’s great. We often work alongside internal teams on security and compliance so they can focus on strategy. Would a quick gap assessment be useful?' },
            { objection: 'Price is too high.', response: 'I get it. We focus on reducing risk and downtime, which usually pays for itself. Can we walk through what you’re spending today on incidents and compare?' },
            { objection: 'Not interested in a long contract.', response: 'We can start with a shorter commitment and expand once you see the value. What term would feel comfortable?' },
          ],
          variables: ['Industry'],
        },
        decisionTree: [
          { ifX: 'Prospect says they’re too busy', suggestY: 'Offer a 5‑minute call or a short email with 3 questions they can answer when ready.' },
          { ifX: 'Prospect asks for a proposal', suggestY: 'Confirm budget and timeline (BANT), then send a one‑page scope and next steps.' },
          { ifX: 'Prospect mentions compliance (HIPAA, SOC 2, PCI)', suggestY: 'Shift to compliance playbook or compliance risk alert; offer a quick readiness check.' },
        ],
        bant: {
          budget: 'Do you have a budget set for IT or security improvements this year?',
          authority: 'Besides yourself, who would need to be involved in a decision like this?',
          need: 'What would need to happen for you to feel it’s worth making a change?',
          timeline: 'What’s your timeline for evaluating or making a decision?',
        },
        closes: {
          soft: 'Would it make sense to schedule a 15‑minute call next week to go deeper?',
          direct: 'If the numbers and scope work, are you in a position to move forward this quarter?',
          riskReversal: 'We can start with a no‑obligation assessment. If it’s not a fit, you’re out nothing. Would that work?',
        },
        pacing: {
          fiveMin: 'Intro + one pain question + one next step (e.g. “Can I send you a short checklist?”).',
          fifteenMin: 'Intro + 2–3 pain questions + one objection handle + soft close.',
          thirtyMin: 'Full discovery, BANT, objection handling, and choose soft/direct/risk‑reversal close.',
        },
        framing: {
          lossAversion: 'Companies that wait until after an incident often pay 2–3x in recovery and reputational cost.',
          riskExposure: 'A quick assessment can show where you’re exposed so you can prioritize.',
          complianceLiability: 'Staying ahead of audits reduces last‑minute scramble and liability.',
        },
        variables: ['CompanyName', 'Industry', 'RiskFactor'],
      },
    },
    {
      slug: 'cold-outbound',
      name: 'Cold Outbound Call',
      description: 'Script for cold outbound calls to prospects with no prior relationship.',
      payload: {
        intro: {
          lines: [
            'Hi, this is [Your Name] with BitBlockIT. We work with {{Industry}} companies in the area on IT security and compliance.',
            'I’m reaching out because we’re seeing more {{Industry}} firms dealing with [compliance / ransomware / support delays]. Is that on your radar?',
          ],
          variables: ['CompanyName', 'Industry'],
        },
        painDiscovery: {
          questions: [
            'What’s your biggest IT or security headache right now?',
            'How do you handle backups and recovery if something goes wrong?',
            'When you need IT support, how long does it usually take to get a response?',
          ],
          variables: [],
        },
        objectionHandling: {
          layers: [
            { objection: 'We’re not interested.', response: 'I understand. If that changes—especially around compliance or an incident—we’re here. Can I leave you with a one‑page checklist you can keep on file?' },
            { objection: 'We already have an MSP.', response: 'A lot of our clients switched from an MSP that was reactive. Would it be worth a 10‑minute comparison so you know your options?' },
            { objection: 'Send me something.', response: 'Happy to. I’ll send a short email with a link to book a call if you’d like to go deeper. What’s the best email?' },
          ],
          variables: [],
        },
        decisionTree: [
          { ifX: 'Gatekeeper answers', suggestY: 'Be brief: “I’m following up on IT/security for [Company]. Who’s the right person to talk to about that?”' },
          { ifX: 'Voicemail', suggestY: 'Leave name, company, one sentence value, and callback number. One follow‑up email with same message.' },
        ],
        bant: {
          budget: 'Do you have budget allocated for IT or security in the next 6–12 months?',
          authority: 'Who else would need to be in the loop on a decision like this?',
          need: 'What would make this a priority for you right now?',
          timeline: 'When do you typically evaluate IT or security partners?',
        },
        closes: {
          soft: 'Would a 10‑minute call next week work to see if it’s worth a deeper look?',
          direct: 'If the fit is right, could you see making a change in the next quarter?',
          riskReversal: 'We can do a no‑cost gap snapshot. No commitment. Would that be useful?',
        },
        pacing: {
          fiveMin: 'Intro + one pain question + ask for next step (email, callback, or short call).',
          fifteenMin: 'Intro + pain discovery + one objection + soft close.',
          thirtyMin: 'Full discovery + BANT + objection handling + close.',
        },
        framing: {
          lossAversion: 'Many teams only act after a breach or failed audit—we help avoid that.',
          riskExposure: 'A quick review can show where you’re exposed without any obligation.',
          complianceLiability: 'Staying ahead of HIPAA/SOC2/PCI reduces last‑minute risk.',
        },
        variables: ['CompanyName', 'Industry', 'RiskFactor'],
      },
    },
    {
      slug: 'warm-inbound',
      name: 'Warm Inbound Lead',
      description: 'Script for leads who came in from website, form, or referral—already showed interest.',
      payload: {
        intro: {
          lines: [
            'Hi {{ContactFirstName}}, this is [Your Name] from BitBlockIT. Thanks for reaching out—I wanted to connect personally.',
            'I see you’re with {{CompanyName}}. What prompted you to get in touch today?',
          ],
          variables: ['ContactFirstName', 'CompanyName'],
        },
        painDiscovery: {
          questions: [
            'What’s the main challenge you’re trying to solve right now?',
            'Have you looked at other options, and what’s held you back?',
            'What would a win look like for you in the next 90 days?',
          ],
          variables: [],
        },
        objectionHandling: {
          layers: [
            { objection: 'Just researching.', response: 'Makes sense. We can keep it to a quick overview so you have a clear comparison when you’re ready.' },
            { objection: 'Need to talk to my partner/team.', response: 'Who else should be on the call so we can cover what matters to everyone?' },
            { objection: 'Timing isn’t right.', response: 'When do you think you’ll be ready? I can send a short follow‑up then.' },
          ],
          variables: [],
        },
        bant: {
          budget: 'Do you have a budget in mind for this?',
          authority: 'Is it just you deciding, or do others need to be involved?',
          need: 'What would need to be true for you to move forward?',
          timeline: 'What’s your ideal timeline to have this in place?',
        },
        closes: {
          soft: 'Would a 15‑minute call this week work to go through options?',
          direct: 'If we can match what you need, are you in a position to get started this quarter?',
          riskReversal: 'We can do a no‑obligation assessment first. Would that help?',
        },
        pacing: {
          fiveMin: 'Thank them, confirm interest, set a specific next step.',
          fifteenMin: 'Discovery + next step (meeting or proposal).',
          thirtyMin: 'Full discovery + BANT + next step.',
        },
        framing: {
          lossAversion: 'Acting now often prevents a bigger issue later.',
          riskExposure: 'We’ll make sure you know exactly where you stand.',
          complianceLiability: 'We can align with your compliance timeline.',
        },
        variables: ['ContactFirstName', 'CompanyName', 'Industry'],
      },
    },
    {
      slug: 'referral',
      name: 'Referral Lead',
      description: 'Script for leads that came from a referral—leverage the referrer’s name.',
      payload: {
        intro: {
          lines: [
            'Hi, this is [Your Name] from BitBlockIT. [Referrer Name] suggested I reach out—they thought we could help {{CompanyName}} with [IT security / compliance / support].',
            'Do you have a few minutes to talk about what’s working for them and whether something similar could work for you?',
          ],
          variables: ['CompanyName', 'ReferrerName'],
        },
        painDiscovery: {
          questions: [
            'What did [Referrer Name] tell you about how we work with them?',
            'Is that similar to what you’re looking for, or is there something else on your mind?',
            'What would be most helpful for you in the next 30 days?',
          ],
          variables: ['ReferrerName'],
        },
        objectionHandling: {
          layers: [
            { objection: 'We’re not looking right now.', response: 'No problem. When would be a better time to reconnect? I can send a short follow‑up then.' },
            { objection: 'We need to think about it.', response: 'Sure. Would it help if I sent a one‑pager you can share with your team?' },
          ],
          variables: [],
        },
        bant: {
          budget: 'Do you have budget set aside for IT or security this year?',
          authority: 'Besides you, who would need to be in the loop?',
          need: 'What would make this a priority?',
          timeline: 'When do you think you’d want to make a decision?',
        },
        closes: {
          soft: 'Would a short call with [Referrer Name] and you make sense so you can hear their experience?',
          direct: 'If it’s a fit, could you see getting started in the next few weeks?',
          riskReversal: 'We’re happy to do a quick assessment at no obligation. Want to schedule that?',
        },
        pacing: {
          fifteenMin: 'Referral context + one pain question + next step.',
          thirtyMin: 'Full discovery + next step.',
        },
        framing: {
          lossAversion: 'Referrals usually move faster because trust is already there.',
          riskExposure: 'We’ll keep the same standards [Referrer Name] relies on.',
          complianceLiability: 'We can align with any compliance needs you have.',
        },
        variables: ['CompanyName', 'ReferrerName', 'Industry'],
      },
    },
    {
      slug: 'compliance',
      name: 'Compliance-Driven Prospect (HIPAA, SOC 2, PCI)',
      description: 'Script for prospects focused on compliance readiness and audits.',
      payload: {
        intro: {
          lines: [
            'Hi, this is [Your Name] from BitBlockIT. We work with {{Industry}} companies on compliance—HIPAA, SOC 2, PCI—so they’re ready for audits, not scrambling at the last minute.',
            'Is compliance or an upcoming audit on your radar for {{CompanyName}}?',
          ],
          variables: ['CompanyName', 'Industry'],
        },
        painDiscovery: {
          questions: [
            'Do you have an audit or assessment coming up? When?',
            'How are you documenting controls and evidence today?',
            'Who owns compliance internally, and do they have enough support?',
          ],
          variables: [],
        },
        objectionHandling: {
          layers: [
            { objection: 'We handle it ourselves.', response: 'A lot of teams do. We often help with documentation and evidence so your team isn’t buried. Want to see what that looks like?' },
            { objection: 'We’re already compliant.', response: 'That’s great. Do you do an annual review? We can do a quick gap check so you’re ready for the next audit.' },
            { objection: 'Too expensive.', response: 'The cost of a failed audit or finding often outweighs the cost of preparation. We can outline options at different investment levels.' },
          ],
          variables: [],
        },
        decisionTree: [
          { ifX: 'Prospect has audit in 90 days', suggestY: 'Offer a readiness assessment and evidence roadmap.' },
          { ifX: 'Prospect says they’re not sure what they need', suggestY: 'Offer a short compliance checklist (HIPAA/SOC2/PCI) and a 15‑min walkthrough.' },
        ],
        bant: {
          budget: 'Do you have budget set for compliance or audit prep this year?',
          authority: 'Who’s responsible for compliance and signing off on vendors?',
          need: 'What would “ready for audit” look like for you?',
          timeline: 'When is your next audit or assessment?',
        },
        closes: {
          soft: 'Would a 15‑minute compliance readiness call make sense?',
          direct: 'If we can get you audit‑ready by [date], would you be in a position to move forward?',
          riskReversal: 'We can do a no‑cost gap snapshot. No obligation. Would that help?',
        },
        pacing: {
          fifteenMin: 'Intro + audit timeline + one pain + next step.',
          thirtyMin: 'Full compliance discovery + BANT + next step.',
        },
        framing: {
          lossAversion: 'Last‑minute audit prep is costly and stressful. We help you stay ahead.',
          riskExposure: 'A gap assessment shows exactly where you stand.',
          complianceLiability: 'Staying current reduces liability and audit findings.',
        },
        variables: ['CompanyName', 'Industry', 'RiskFactor'],
      },
    },
    {
      slug: 'ransomware',
      name: 'Ransomware-Breached or Worried Prospect',
      description: 'Script for prospects who experienced or are worried about ransomware.',
      payload: {
        intro: {
          lines: [
            'Hi, this is [Your Name] from BitBlockIT. We work with companies that have been hit by ransomware or want to make sure they’re not next.',
            'I’m reaching out to see if {{CompanyName}} has had any incidents or is looking to harden things. Is that relevant for you right now?',
          ],
          variables: ['CompanyName'],
        },
        painDiscovery: {
          questions: [
            'Have you had an incident, or are you mainly looking to prevent one?',
            'How are your backups and recovery tested today?',
            'Do you have offline/immutable backups, or everything on the same network?',
          ],
          variables: [],
        },
        objectionHandling: {
          layers: [
            { objection: 'We’re fine, we have backups.', response: 'A lot of teams find out during an incident that backups were encrypted too. Have you tested a full restore recently?' },
            { objection: 'We can’t afford it right now.', response: 'The cost of one incident usually dwarfs the cost of prevention. We can outline a phased approach that fits your budget.' },
            { objection: 'We have cyber insurance.', response: 'Insurance helps after the fact, but carriers are tightening requirements. We can help you meet those and reduce the chance of a claim.' },
          ],
          variables: [],
        },
        decisionTree: [
          { ifX: 'Prospect was already breached', suggestY: 'Lead with recovery and hardening: backups, segmentation, MFA, and monitoring.' },
          { ifX: 'Prospect is only worried', suggestY: 'Offer a risk snapshot and a simple hardening checklist.' },
        ],
        bant: {
          budget: 'Do you have budget for security improvements this year?',
          authority: 'Who needs to sign off on security spend?',
          need: 'What would need to be true for you to move forward?',
          timeline: 'When do you want to have stronger controls in place?',
        },
        closes: {
          soft: 'Would a 15‑minute security snapshot call make sense?',
          direct: 'If we can get you to a much safer posture in the next 90 days, would you be in a position to start?',
          riskReversal: 'We can do a no‑cost risk snapshot. No obligation. Would that be useful?',
        },
        pacing: {
          fifteenMin: 'Intro + one incident/prevention question + next step.',
          thirtyMin: 'Discovery + backup/security posture + next step.',
        },
        framing: {
          lossAversion: 'One incident can cost far more than prevention and recovery readiness.',
          riskExposure: 'A quick assessment shows where you’re exposed and how to prioritize.',
          complianceLiability: 'Many insurers and auditors now expect specific controls.',
        },
        variables: ['CompanyName', 'Industry', 'RiskFactor'],
      },
    },
    {
      slug: 'cost-cutting',
      name: 'Cost-Cutting Focused Prospect',
      description: 'Script for prospects focused on reducing IT spend or improving value.',
      payload: {
        intro: {
          lines: [
            'Hi, this is [Your Name] from BitBlockIT. We work with companies that want to get more from their IT spend—better support, less downtime, and predictable costs.',
            'Is {{CompanyName}} looking to reduce IT cost or get better value from what you spend today?',
          ],
          variables: ['CompanyName'],
        },
        painDiscovery: {
          questions: [
            'What are you spending on IT today, and what’s included?',
            'Where do you feel you’re overpaying or under‑supported?',
            'How much do unplanned outages or slow support cost you in time and money?',
          ],
          variables: [],
        },
        objectionHandling: {
          layers: [
            { objection: 'We’re cutting costs, not adding.', response: 'We often help teams consolidate and get more for the same or less—fewer surprises, better support. Would a quick comparison be useful?' },
            { objection: 'Our current provider is cheap.', response: 'Cheap can work until something breaks or you need compliance. We can show total cost including risk and downtime.' },
            { objection: 'We need to see numbers.', response: 'Happy to. What’s your current monthly or annual IT spend? We can map that to what you’d get with us.' },
          ],
          variables: [],
        },
        bant: {
          budget: 'What’s your target IT spend, and what’s it today?',
          authority: 'Who approves IT budget changes?',
          need: 'What would “better value” look like for you?',
          timeline: 'When do you need to make a decision?',
        },
        closes: {
          soft: 'Would a 15‑minute call to compare your current setup to our model make sense?',
          direct: 'If we can match or beat your current cost with better support, would you be open to switching?',
          riskReversal: 'We can do a no‑obligation cost comparison. No commitment. Want to try that?',
        },
        pacing: {
          fifteenMin: 'Intro + current spend + one value question + next step.',
          thirtyMin: 'Spend discovery + value + next step.',
        },
        framing: {
          lossAversion: 'Downtime and incidents often cost more than a slightly higher monthly fee.',
          riskExposure: 'We’ll show where you might be over‑ or under‑investing.',
          complianceLiability: 'Staying compliant avoids fines and audit costs.',
        },
        variables: ['CompanyName', 'Industry'],
      },
    },
    {
      slug: 'frustrated-msp',
      name: 'Frustrated with Current MSP',
      description: 'Script for prospects unhappy with their current MSP (breakup / switch).',
      payload: {
        intro: {
          lines: [
            'Hi, this is [Your Name] from BitBlockIT. We work with companies that are tired of slow tickets, reactive support, and MSPs that don’t feel like a partner.',
            'Is that where {{CompanyName}} is at with your current provider?',
          ],
          variables: ['CompanyName'],
        },
        painDiscovery: {
          questions: [
            'What’s the biggest frustration with your current MSP?',
            'How long does it usually take to get a real response or fix?',
            'Do you have a strategic roadmap from them, or is it mostly break‑fix?',
          ],
          variables: [],
        },
        objectionHandling: {
          layers: [
            { objection: 'We’re under contract.', response: 'When does the contract end? We can have a plan ready so you can switch without a gap.' },
            { objection: 'Switching is a hassle.', response: 'We handle the transition so you don’t have to. We can outline what that looks like and how long it takes.' },
            { objection: 'We need to think about it.', response: 'Sure. Would it help if I sent a short “what to look for in your next MSP” checklist you can use to compare?' },
          ],
          variables: [],
        },
        decisionTree: [
          { ifX: 'Prospect says they’re locked in', suggestY: 'Ask contract end date; offer to stay in touch and send a transition checklist.' },
          { ifX: 'Prospect is ready to switch', suggestY: 'Propose a transition call and timeline; confirm decision‑makers.' },
        ],
        bant: {
          budget: 'What are you paying today, and what would you be willing to pay for better service?',
          authority: 'Who would need to approve a switch?',
          need: 'What would need to be true for you to make a change?',
          timeline: 'When does your current contract end, or when do you want to make a move?',
        },
        closes: {
          soft: 'Would a 15‑minute call to compare what you have now to what we offer make sense?',
          direct: 'If we can match what you need and handle the switch smoothly, could you see moving in the next 90 days?',
          riskReversal: 'We can outline a no‑obligation transition plan. Would that help?',
        },
        pacing: {
          fifteenMin: 'Intro + main frustration + next step.',
          thirtyMin: 'Full frustration discovery + BANT + transition options + next step.',
        },
        framing: {
          lossAversion: 'Staying with a bad fit costs you time and risk every month.',
          riskExposure: 'We’ll show how our approach differs so you can compare fairly.',
          complianceLiability: 'A true partner keeps you compliant and proactive.',
        },
        variables: ['CompanyName', 'Industry'],
      },
    },
  ];

  for (const p of playbooks) {
    await prisma.salesPlaybook.upsert({
      where: { slug: p.slug },
      update: { name: p.name, description: p.description, payload: p.payload as object },
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        payload: p.payload as object,
        isActive: true,
      },
    });
  }

  console.log('Seed done: admin user, default pipeline, roles, outbound email templates, MSP sequences/templates, tags, option lists, activity types, sales playbooks.');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
