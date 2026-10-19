// <ax-tile-bound>: the boundary of a Start screen, around tile groups. It draws nothing; the
// groups inside it, at any depth and across shadow roots, find it when they connect, and their
// desktop entrances then run as one: the bands go on from one group to the next, 35 ms apart, and
// every band grows about the middle of all the groups across them, as the Start screen of Windows
// 8.1 does.
//
// The groups whose desktop entrance starts within WAVE_MS of the first one form a wave; the bands
// are counted among the members of a wave only, so a group that enters later (scrolled into view,
// added) starts its own wave at band 0 instead of waiting behind the others.

// Server-side rendering imports this module without a DOM.
const ElementBase: typeof HTMLElement = typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement);

// ms: the entrances that start this close to the first of a wave join it. One task (the restore
// after a launch) or one frame of IntersectionObserver callbacks fits easily.
const WAVE_MS = 50;

// What the boundary asks of a group: its axis, and the bands its desktop entrance has.
export interface BoundaryMember extends HTMLElement {
    boundaryInfo(): { vertical: boolean; bands: number };
}

// Where a member sits in its wave: the bands before it, and the middle of the wave across its
// axis, in its own px.
export interface WavePlace {
    offset: number;
    across: number;
}

interface Wave {
    start: number;
    // In the order they joined.
    members: BoundaryMember[];
    // The places, measured on the first read after a change (null: to measure).
    places: Map<BoundaryMember, WavePlace> | null;
}

export class AxTileBoundary extends ElementBase {
    static readonly ElementName: string = 'ax-tile-bound';

    // Every group of the boundary, and the wave of its last desktop entrance (null: none).
    private members = new Map<BoundaryMember, Wave | null>();
    private latest: Wave | null = null;
    private listening = false;

    add(member: BoundaryMember): void {
        if (!this.members.has(member)) this.members.set(member, null);
        if (!this.listening && typeof window !== 'undefined') {
            this.listening = true;
            window.addEventListener('resize', this.onResize);
        }
    }

    delete(member: BoundaryMember): void {
        this.leave(member);
        this.members.delete(member);
        if (!this.members.size && this.listening) {
            this.listening = false;
            window.removeEventListener('resize', this.onResize);
        }
    }

    // A desktop entrance of the member starts at `now`: it joins the wave that started less than
    // WAVE_MS ago, or starts a new one.
    join(member: BoundaryMember, now: number): void {
        this.leave(member);
        let wave = this.latest;
        if (!wave || !wave.members.length || now - wave.start > WAVE_MS) {
            wave = { start: now, members: [], places: null };
            this.latest = wave;
        }
        wave.members.push(member);
        wave.places = null;
        this.members.set(member, wave);
    }

    // Another kind of run starts (an exit, the turnstile): the member is no longer counted with the
    // others. A finished entrance stays in its wave, so the others keep their bands.
    leave(member: BoundaryMember): void {
        const wave = this.members.get(member);
        if (!wave) return;
        this.members.set(member, null);
        const i = wave.members.indexOf(member);
        if (i >= 0) wave.members.splice(i, 1);
        wave.places = null;
    }

    // The layout of the member changed (its size, its bands): its wave is measured again.
    changed(member: BoundaryMember): void {
        const wave = this.members.get(member);
        if (wave) wave.places = null;
    }

    // The place of the member in its wave, or null when it is in none. Measured once per change of
    // the wave, not at every frame of every group.
    place(member: BoundaryMember): WavePlace | null {
        const wave = this.members.get(member);
        if (!wave) return null;
        if (!wave.places) wave.places = measure(wave.members);
        return wave.places.get(member) || null;
    }

    private onResize = () => {
        this.members.forEach((wave) => {
            if (wave) wave.places = null;
        });
    };
}

// The places of the members of a wave, from their boxes now. Ties along the axis go by document
// order.
function measure(list: BoundaryMember[]): Map<BoundaryMember, WavePlace> {
    const members = list.slice().sort(documentOrder);
    const rects = members.map((m) => m.getBoundingClientRect());
    const infos = members.map((m) => m.boundaryInfo());
    const bands = infos.map((i) => i.bands);
    // The offsets along each axis, worked out only for an axis a member has.
    const offsets: { [axis: string]: number[] } = {};
    const offsetsAlong = (vertical: boolean) => {
        const key = vertical ? 'v' : 'h';
        if (!offsets[key]) offsets[key] = bandOffsets(rects.map((r) => (vertical ? r.top : r.left)), bands);
        return offsets[key];
    };
    const places = new Map<BoundaryMember, WavePlace>();
    members.forEach((m, i) => {
        const vertical = infos[i].vertical;
        const r = rects[i];
        const middle = vertical ? spanMiddle(rects.map((q) => q.left), rects.map((q) => q.right)) : spanMiddle(rects.map((q) => q.top), rects.map((q) => q.bottom));
        places.set(m, { offset: offsetsAlong(vertical)[i], across: middle - (vertical ? r.left : r.top) });
    });
    return places;
}

function documentOrder(a: Node, b: Node): number {
    const position = a.compareDocumentPosition(b);
    // In different trees (shadow roots) the order of joining stays.
    if (position & Node.DOCUMENT_POSITION_DISCONNECTED) return 0;
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
}

/**
 * The band offset of each member: the bands of the members that come before it along the axis.
 * `leads` are their leading edges (left, or top when vertical), `bands` their band counts; equal
 * edges keep the order of the lists.
 */
export function bandOffsets(leads: number[], bands: number[]): number[] {
    const order = leads.map((_, i) => i);
    // The index breaks ties, so the order is the same where sort is not stable.
    order.sort((a, b) => leads[a] - leads[b] || a - b);
    const out: number[] = new Array(leads.length);
    let sum = 0;
    for (const i of order) {
        out[i] = sum;
        sum += bands[i];
    }
    return out;
}

/** The middle of the union of spans, from their starts and ends. */
export function spanMiddle(starts: number[], ends: number[]): number {
    return (Math.min.apply(null, starts) + Math.max.apply(null, ends)) / 2;
}

/** The band count of a group: its extent in cells along its axis, in bands of `bandSize`. */
export function bandCount(extent: number, bandSize: number): number {
    return Math.ceil(extent / Math.max(1, bandSize));
}

// The boundary around a node, through shadow roots; null when there is none.
export function closestBoundary(node: Node): AxTileBoundary | null {
    for (let n: Node | null = node.parentNode || (node as ShadowRoot).host || null; n; n = n.parentNode || (n as ShadowRoot).host || null) {
        if (n instanceof AxTileBoundary) return n;
    }
    return null;
}
