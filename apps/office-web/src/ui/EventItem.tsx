import type { StoredEvent } from '@cc/shared';
import { formatClock, formatCost, formatTokens, summarizeToolInput } from './format.ts';
import { lifecycleLabel } from './labels.ts';
import { PlanCard } from './PlanCard.tsx';

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
          Plan “{e.plan.title}”: {e.change === 'approved' ? 'onaylandı' : e.change === 'declined' ? 'vazgeçildi' : 'bitti'}
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
    case 'task.changed':
      if (e.change !== 'created' && e.change !== 'finished' && e.change !== 'started') return null;
      return (
        <div className="note">
          Görev {e.change === 'created' ? 'açıldı' : e.change === 'started' ? 'başladı' : 'bitti'}: {e.task.title}
        </div>
      );
    case 'brief.updated':
      return <div className="note">Şirket özeti güncellendi</div>;
    case 'role.changed':
      return <div className="note">Rol: {e.title || e.kind}</div>;
    default:
      return null;
  }
}
