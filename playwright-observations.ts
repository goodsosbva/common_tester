import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Signal = { scenario_key: string; kind: 'class' | 'disabled' | 'unknown'; selector?: string; reason: string; allow_class?: string; deny_class?: string };
const file = process.env.COMMON_TESTER_OBSERVATIONS;
const signals: Signal[] = file ? JSON.parse(readFileSync(file, 'utf8')).scenarios : [];

export const test = base.extend<{ observedPolicy: void }>({
  observedPolicy: [async ({ page }, use, info) => {
    try { await use(); }
    finally {
      const key = info.title.split(' ')[0];
      const signal = signals.find(item => item.scenario_key === key);
      const result: Record<string, unknown> = { scenario_key: key, actual_policy: 'unknown', reason: signal?.reason || '허용/거부 관찰 계약이 없습니다.', selector: signal?.selector || null, text: '', kind: signal?.kind || 'unknown', value: null };
      try {
        if (signal && signal.kind !== 'unknown' && signal.selector) {
          const element = page.locator(signal.selector);
          if (await element.count() !== 1) throw Error('관찰 요소를 하나로 확인할 수 없습니다.');
          result.text = (await element.innerText()).slice(0, 2000);
          if (signal.kind === 'class') {
            const classes = (await element.getAttribute('class') || '').split(/\s+/);
            const allow = !!signal.allow_class && classes.includes(signal.allow_class);
            const deny = !!signal.deny_class && classes.includes(signal.deny_class);
            result.value = classes.join(' ');
            if (allow !== deny) result.actual_policy = allow ? 'allow' : 'deny';
            else result.reason = '허용 또는 거부 상태를 하나로 확인할 수 없습니다.';
          } else if (signal.kind === 'disabled') {
            const disabled = await element.isDisabled();
            result.value = disabled;
            result.actual_policy = disabled ? 'deny' : 'allow';
          }
        }
      } catch (error) { result.actual_policy = 'unknown'; result.reason = String(error); }
      await info.attach('common-tester-observation', { body: Buffer.from(JSON.stringify(result)), contentType: 'application/json' });
    }
  }, { auto: true }],
});
export { expect };
