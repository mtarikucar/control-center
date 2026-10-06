import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QuotaHud } from './QuotaHud.tsx';

afterEach(cleanup);

describe('QuotaHud', () => {
  it('shows a window that has already reset as empty instead of its stale reading', () => {
    const now = new Date(2026, 9, 6, 12, 0).getTime();
    render(
      <QuotaHud
        now={now}
        quota={{ status: 'allowed', fiveHour: { utilization: 0.9, resetsAt: now - 60_000 }, sevenDay: { utilization: 0.3, resetsAt: now + 3_600_000 }, updatedAt: now - 7_200_000 }}
      />,
    );
    const five = screen.getByText('5 saat').closest('.meter')!;
    expect(five.textContent).toContain('%0');
    expect(five.textContent).toContain('yenilendi');
    expect(five.querySelector('.meter-fill.hot')).toBeNull();
    expect(screen.getByText('7 gün').closest('.meter')!.textContent).toContain('%30');
  });
});
