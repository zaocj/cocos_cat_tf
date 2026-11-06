import { expect, test } from 'vitest';
import { ToastState } from '../assets/scripts/presentation/ToastState.ts';

test('toast starts hidden, fades in and out, and expires using UI time', () => {
    const toast = new ToastState();
    expect(toast.visible).toBe(false);
    toast.show('灵露不足，还差 30 灵露', 'warning');
    expect(toast.visible).toBe(true);
    expect(toast.opacity).toBe(0);
    toast.update(0.12); expect(toast.opacity).toBe(255);
    toast.update(2.17); expect(toast.opacity).toBeGreaterThan(0); expect(toast.opacity).toBeLessThan(255);
    toast.update(0.11); expect(toast.visible).toBe(false); expect(toast.opacity).toBe(0);
});

test('repeated toast does not extend its lifetime; a different message replaces it', () => {
    const toast = new ToastState();
    toast.show('灵露不足', 'warning'); toast.update(2);
    expect(toast.show('灵露不足', 'warning')).toBe(false);
    toast.update(0.5); expect(toast.visible).toBe(false);
    expect(toast.show('灵露不足', 'warning')).toBe(true);
    expect(toast.show('场上已满', 'info')).toBe(true);
    expect(toast.message).toBe('场上已满'); expect(toast.tone).toBe('info');
    toast.dismiss(); expect(toast.visible).toBe(false);
    expect(toast.show('   ')).toBe(false);
});
