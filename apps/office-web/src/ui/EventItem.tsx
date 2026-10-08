import { APPROVAL_KIND_LABELS, APPROVAL_STATUS_LABELS, PROFILE_SPEC, reviewTally, type PlanChange, type ScheduleChange, type StoredEvent } from '@cc/shared';
import { formatClock, formatCost, formatTokens, formatWhenTR, summarizeToolInput } from './format.ts';
import { lifecycleLabel } from './labels.ts';
import { PlanCard } from './PlanCard.tsx';
import { ProposalCard } from './ProposalCard.tsx';
import { ApprovalCard } from './ApprovalCard.tsx';

const PLAN_CHANGE: Record<PlanChange, string> = {
  proposed: 'önerildi',
  revised: 'güncellendi',
  approved: 'onaylandı',
  declined: 'vazgeçildi',
  done: 'açık görevi kalmadı',
  reopened: 'yeniden açıldı',
  kept: 'revizyon reddedildi, onaylı sürümüyle sürüyor',
  stopped: 'durduruldu',
};

const SCHEDULE_CHANGE: Record<ScheduleChange, string> = {
  created: 'açıldı',
  updated: 'güncellendi',
  fired: 'çalıştı',
  skipped: 'atlandı',
  paused: 'duraklatıldı',
  resumed: 'sürdürüldü',
  stopped: 'durduruldu',
};

export function EventItem({ stored }: { stored: StoredEvent }) {
  const e = stored.event;
  const time = <time>{formatClock(stored.ts)}</time>;
  switch (e.type) {
    case 'message.user':
      return (
        <div className={`msg ${e.source}`}>
          <span className="who">{e.source === 'owner' ? 'Sen' : 'Ofis'}</span>
          <p>{e.text}</p>
          {time}
        </div>
      );
    case 'message.assistant':
      return (
        <div className="msg assistant">
          <p>{e.text}</p>
          {time}
        </div>
      );
    case 'tool.started':
      return (
        <div className="tool">
          <span className="tool-name">⚙ {e.name}</span> <code>{summarizeToolInput(e.name, e.input)}</code>
        </div>
      );
    case 'tool.finished':
      return (
        <details className={`tool-out ${e.isError ? 'err' : ''}`}>
          <summary>{e.isError ? 'Araç hatası' : 'Araç çıktısı'}</summary>
          <pre>{e.output}</pre>
        </details>
      );
    case 'side.question':
      return (
        <div className="msg side">
          <span className="who">Yan soru</span>
          <p>{e.text}</p>
        </div>
      );
    case 'side.answer':
      return (
        <div className="msg side answer">
          <span className="who">Yan cevap</span>
          <p>{e.text}</p>
        </div>
      );
    case 'lifecycle.changed':
      return (
        <div className="note">
          {lifecycleLabel(e.from)} → {lifecycleLabel(e.to)} · {e.reason}
        </div>
      );
    case 'turn.finished':
      return (
        <div className="note">
          Tur bitti · {formatTokens(e.usage.inputTokens + e.usage.outputTokens)} · {formatCost(e.costUsd)}
        </div>
      );
    case 'error':
      return <div className="note error">{e.message}</div>;
    case 'session.started': {
      const failed = e.mcp.filter((m) => m.status === 'failed');
      if (failed.length === 0) return null;
      return (
        <details className="note warn">
          <summary>{failed.length} bağlantı açılamadı</summary>
          <span>{failed.map((m) => m.name).join(', ')}</span>
        </details>
      );
    }
    case 'plan.changed':
      if (e.change === 'proposed' || e.change === 'revised') return <PlanCard plan={e.plan} />;
      return (
        <div className="note">
          Plan “{e.plan.title}”: {PLAN_CHANGE[e.change]}
        </div>
      );
    case 'company.report':
      return (
        <div className="msg report">
          <span className="who">Rapor</span>
          <p>{e.text}</p>
          {time}
        </div>
      );
    case 'goal.changed':
      return (
        <div className="note">
          {e.change === 'set' ? `Hedef: ${e.goal.title}` : e.change === 'stopped' ? `Hedef durduruldu: ${e.goal.title}` : e.change === 'closed' ? `Hedef kapandı: ${e.goal.title}` : `Hedef güncellendi: ${e.goal.title}`}
        </div>
      );
    case 'company.paused':
      return <div className="note">{e.paused ? 'Şirket duraklatıldı' : 'Şirket sürdürüldü'}</div>;
    case 'task.changed': {
      if (e.change === 'in_review') return <div className="note">Görev incelemede: {e.task.title}</div>;
      if (e.change === 'reviewed') {
        const r = e.task.result?.review;
        const tally = r ? reviewTally(r.findings) : '';
        return (
          <div className="note">
            {`${e.task.title} — ${r?.decision === 'approve' ? 'onaylandı' : 'değişiklik istendi'}${tally ? ` (${tally})` : ''}`}
          </div>
        );
      }
      if (e.change === 'parked') {
        // As it was said when parked: read a day later, “yarın” must not turn into “bugün”.
        const back = e.task.notBefore ? formatWhenTR(e.task.notBefore, stored.ts) : null;
        const why = [back, e.task.parkedReason].filter(Boolean).join(' — ');
        return <div className="note">{`Görev ertelendi: ${e.task.title}${why ? ` (${why})` : ''}`}</div>;
      }
      if (e.change === 'returned') return <div className="note">Görev sıraya döndü: {e.task.title}</div>;
      if (e.change !== 'created' && e.change !== 'finished' && e.change !== 'started') return null;
      return (
        <div className="note">
          Görev {e.change === 'created' ? 'açıldı' : e.change === 'started' ? 'başladı' : 'bitti'}: {e.task.title}
        </div>
      );
    }
    case 'schedule.changed':
      return (
        <div className="note">
          Rutin {SCHEDULE_CHANGE[e.change]}: {e.schedule.title}
        </div>
      );
    case 'clock.jumped':
      return <div className="note warn">{`Saat atladı: beklenen ${formatWhenTR(e.expectedAt, Date.now())}, gerçek ${formatWhenTR(e.actualAt, Date.now())}`}</div>;
    case 'clock.error':
      return <div className="note error">{`Saat: ${e.job} başarısız — ${e.message}`}</div>;
    case 'brief.updated':
      return <div className="note">Şirket özeti güncellendi</div>;
    case 'profile.updated':
      return <div className="note">{`Şirket profili: ${PROFILE_SPEC[e.entry.section].label} (sürüm ${e.entry.version}${e.entry.assumed ? ', varsayım' : ''})`}</div>;
    case 'role.changed':
      return <div className="note">Rol: {e.title || e.kind}</div>;
    case 'decision.recorded':
      return (
        <div className="note">
          {e.decision.reverts ? `Sahibi bir kararı geri aldı: ${e.decision.title.replace(/^Geri alındı: /, '')}` : `Karar: ${e.decision.title} → ${e.decision.chosen}`}
        </div>
      );
    case 'playbook.updated':
      return <div className="note">{`El kitabı: ${e.topic} (sürüm ${e.version})`}</div>;
    case 'note.written':
      return <div className="note">{`Not: ${e.title}`}</div>;
    case 'spend.recorded':
      return <div className="note">{`Harcama: ${e.spend.service} $${e.spend.usd} — ${e.spend.purpose}`}</div>;
    case 'model.changed':
      return <div className="note">{`Model: ${e.model}`}</div>;
    case 'model.switch.failed':
      return <div className="note">{`Model geçişi olmadı (${e.to}): ${e.from} ile sürüyor. ${e.reason}`}</div>;
    case 'gate.checked':
      return <div className="note">{`Kapı: ${APPROVAL_KIND_LABELS[e.kind]} — ${e.target} (${e.tool}) ${e.decision === 'allow' ? 'sahibinin onayıyla geçti' : 'onay bekliyor'}`}</div>;
    case 'approval.changed':
      return e.change === 'requested' ? <ApprovalCard approval={e.approval} /> : <div className="note">{`Onay “${e.approval.target}”: ${APPROVAL_STATUS_LABELS[e.approval.status]}`}</div>;
    case 'proposal.changed':
      return e.change === 'opened' || e.change === 'escalated' ? <ProposalCard proposal={e.proposal} /> : <div className="note">{`Öneri “${e.proposal.title}”: ${e.change === 'accepted' ? 'kabul edildi' : 'reddedildi'}`}</div>;
    default:
      return null;
  }
}
