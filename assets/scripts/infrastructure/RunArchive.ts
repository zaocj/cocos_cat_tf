import { MvpSession, RunSnapshot, validMutationRecord } from '../domain/MvpSession';
import { GUIDE_IDS, PlayerProfile } from '../domain/FirstGuide';
import { mutationKey, MUTATION_FORM_COUNT } from '../domain/PetGrowth';

export const SAVE_SCHEMA = 1;
export const CONTENT_VERSION = 'mvp-2026-11-11-mutation-stack-1';
export const SAVE_KEYS = { primary: 'cute-mutation.archive.v1', backup: 'cute-mutation.archive.v1.backup' } as const;
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface ArchiveBody { run: RunSnapshot | null; profile: PlayerProfile }
export type LoadStatus = 'empty' | 'ready' | 'recovered' | 'corrupt' | 'incompatible' | 'unavailable';
export interface ArchiveLoad { status: LoadStatus; data: ArchiveBody | null; message: string }
interface Envelope { schema: number; content: string; revision: number; body: string; checksum: string }
type Decoded = { ok: true; envelope: Envelope; data: ArchiveBody } | { ok: false; incompatible: boolean };

function checksum(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function decode(raw: string): Decoded {
    if (raw.length > 1000000) return { ok: false, incompatible: false };
    try {
        const envelope: unknown = JSON.parse(raw);
        if (!record(envelope)) return { ok: false, incompatible: false };
        if (typeof envelope.schema !== 'number' || typeof envelope.content !== 'string') return { ok: false, incompatible: false };
        if (envelope.schema !== SAVE_SCHEMA || envelope.content !== CONTENT_VERSION) return { ok: false, incompatible: true };
        if (typeof envelope.body !== 'string' || envelope.checksum !== checksum(envelope.body)
            || typeof envelope.revision !== 'number' || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1)
            return { ok: false, incompatible: false };
        const body: unknown = JSON.parse(envelope.body);
        if (!record(body) || !record(body.profile) || !Array.isArray(body.profile.guideSeen)
            || !body.profile.guideSeen.every(id => GUIDE_IDS.some(known => known === id))
            || !(body.profile.speed === undefined || body.profile.speed === 1 || body.profile.speed === 2)
            || new Set(body.profile.guideSeen).size !== body.profile.guideSeen.length)
            return { ok: false, incompatible: false };
        const collection: unknown = body.profile.mutationCollection;
        const last: unknown = body.profile.lastExpedition;
        const formsValid = (value: unknown): boolean => Array.isArray(value) && value.length <= MUTATION_FORM_COUNT
            && value.every(validMutationRecord) && new Set(value.map(mutationKey)).size === value.length;
        if (collection !== undefined && !formsValid(collection)) return { ok: false, incompatible: false };
        if (last !== undefined && (!record(last) || !Number.isSafeInteger(last.seed) || typeof last.seed !== 'number'
            || last.seed < 0 || last.seed > 0xffffffff || !['won', 'lost'].includes(String(last.outcome))
            || !Number.isSafeInteger(last.nodes) || typeof last.nodes !== 'number' || last.nodes < 0 || last.nodes > 12
            || typeof last.debugModified !== 'boolean'
            || last.outcome === 'won' && last.nodes !== 12 || !formsValid(last.forms))) return { ok: false, incompatible: false };
        const run = body.run === null ? null : MvpSession.restore(body.run).snapshot();
        // Shape is checked above; copy only the known profile fields, never arbitrary envelope properties.
        const profile = JSON.parse(JSON.stringify({ guideSeen: body.profile.guideSeen, speed: body.profile.speed,
            mutationCollection: collection, lastExpedition: last })) as PlayerProfile;
        const data: ArchiveBody = { run, profile };
        return { ok: true, envelope: { schema: SAVE_SCHEMA, content: CONTENT_VERSION, revision: envelope.revision,
            body: envelope.body, checksum: checksum(envelope.body) }, data };
    } catch { return { ok: false, incompatible: false }; }
}

/** Own-key-only storage, previous-good backup, versioned data, and explicit failure results. */
export class RunArchive {
    private previous: string | null = null;
    private body = '';
    private revision = 0;
    private needsRepair = false;
    constructor(private readonly storage: StoragePort) {}

    load(): ArchiveLoad {
        let primary: string | null; let backup: string | null;
        try { primary = this.storage.getItem(SAVE_KEYS.primary); backup = this.storage.getItem(SAVE_KEYS.backup); }
        catch { return { status: 'unavailable', data: null, message: '设备存储不可用，可以选择本次不保存试玩。' }; }
        if (!primary && !backup) return { status: 'empty', data: null, message: '' };
        const first = primary ? decode(primary) : null;
        if (first?.ok) return this.accept(primary, first, 'ready', '');
        // Do not downgrade or overwrite a newer/incompatible archive without a deliberate new run.
        if (first && first.ok === false && first.incompatible)
            return { status: 'incompatible', data: null, message: '存档版本与当前游戏不兼容。原记录已保留，新远征会覆盖它。' };
        const fallback = backup ? decode(backup) : null;
        if (fallback?.ok) return this.accept(backup, fallback, 'recovered', '主存档缺失或损坏，已找到上一次有效备份。');
        return { status: 'corrupt', data: null, message: '存档和备份都无法读取。原记录已保留，可确认后开始新远征。' };
    }

    private accept(raw: string | null, decoded: Extract<Decoded, { ok: true }>, status: LoadStatus, message: string): ArchiveLoad {
        this.previous = raw; this.body = decoded.envelope.body; this.revision = decoded.envelope.revision;
        this.needsRepair = status === 'recovered';
        return { status, data: decoded.data, message };
    }

    save(game: MvpSession, profile: PlayerProfile): { ok: true } | { ok: false; message: string } {
        const body = JSON.stringify({ run: game.snapshot(), profile });
        if (body === this.body && !this.needsRepair) return { ok: true };
        const raw = JSON.stringify({ schema: SAVE_SCHEMA, content: CONTENT_VERSION,
            revision: this.revision + 1, body, checksum: checksum(body) });
        try {
            // setItem replaces one value atomically; never delete the last good copy before committing.
            if (this.previous) this.storage.setItem(SAVE_KEYS.backup, this.previous);
            this.storage.setItem(SAVE_KEYS.primary, raw);
        } catch { return { ok: false, message: '存档写入失败，可能是存储空间不足或设备限制。当前进度仍在内存中。' }; }
        this.previous = raw; this.body = body; this.revision++; this.needsRepair = false;
        return { ok: true };
    }
}
