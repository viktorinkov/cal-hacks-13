/**
 * Seeded demo venue: one main stage, eleven crowd zones, two open passages and a closed one, four
 * exits and gates, two cameras, a gateway and anchor stations, preapproved responder corridors and
 * the built structures the 3D map extrudes (stage, LED wall, towers, tents, bars, food trucks...).
 *
 * This is configuration data. It has the same shape the Rust backend sends in its snapshot, and
 * venue.test.ts validates it against the wire schema. Units are metres, origin top-left, y south.
 */
import type { Platform, ResponderCorridor, Stair, Structure, Vec2, Venue, VenueZone } from '@/contracts/domain'
import { polygonArea, polylineLength, rect } from '@/lib/geometry'
import { HEADLINER, SUPPORT } from './clock'

const W = 100
const H = 64

const p = (x: number, y: number): Vec2 => ({ x, y })

function zone(
  zoneId: string,
  name: string,
  section: VenueZone['section'],
  x: number,
  y: number,
  w: number,
  h: number,
  minus = 0,
  elevationM = 0,
): VenueZone {
  const polygon = rect(x, y, w, h)
  return {
    zoneId,
    name,
    section,
    polygon,
    areaM2: polygonArea(polygon) - minus,
    labelAt: { x: x + w / 2, y: y + h / 2 },
    ...(elevationM ? { elevationM } : {}),
  }
}

function corridor(
  corridorId: string,
  name: string,
  path: Vec2[],
  servesZoneIds: string[],
  viaWalkwayIds: string[],
): ResponderCorridor {
  return {
    corridorId,
    name,
    fromStationId: 'FA-01',
    path,
    widthM: 3,
    lengthM: Math.round(polylineLength(path)),
    servesZoneIds,
    viaWalkwayIds,
    preapproved: true,
  }
}

let sid = 0
function box(
  kind: Structure['kind'],
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  heightM: number,
  blocksMovement = true,
  baseM = 0,
): Structure {
  sid += 1
  return { structureId: `S-${String(sid).padStart(3, '0')}`, name, kind, footprint: rect(x, y, w, h), heightM, baseM, blocksMovement }
}

function railAt(name: string, a: Vec2, b: Vec2, baseM: number): Structure {
  const r = run('rail', name, a, b, 1.05, 0.12)
  return { ...r, baseM, blocksMovement: true }
}

/** A thin wall or fence along a straight run. */
function run(kind: Structure['kind'], name: string, a: Vec2, b: Vec2, heightM: number, thickness = 0.2): Structure {
  const horizontal = Math.abs(b.y - a.y) < Math.abs(b.x - a.x)
  const x = Math.min(a.x, b.x) - (horizontal ? 0 : thickness / 2)
  const y = Math.min(a.y, b.y) - (horizontal ? thickness / 2 : 0)
  const w = horizontal ? Math.abs(b.x - a.x) : thickness
  const h = horizontal ? thickness : Math.abs(b.y - a.y)
  return box(kind, name, x, y, w, h, heightM)
}

/** Height of the stand terraces. */
const STAND_H = 3.2
const STAND_W = 8.5
/** North and south stands on each side, with the side exit between them. */
const STANDS = [
  { key: 'N', name: 'North', y: 8.5, h: 11, stairY: 14.5 },
  { key: 'S', name: 'South', y: 26.5, h: 11.5, stairY: 30 },
]
const STAIR_LEN = 4
const STAIR_W = 2

/** Mirror an x coordinate (and a width) onto the east side. */
function side(east: boolean, x: number, w = 0): number {
  return east ? 100 - x - w : x
}

function standStructures(label: string, east: boolean): Structure[] {
  const out: Structure[] = []
  for (const st of STANDS) {
    const x0 = side(east, 0, STAND_W)
    out.push(box('tier', `${label} Stand ${st.name}`, x0, st.y, STAND_W, st.h, STAND_H))
    out.push(box('bar', `${label} Stand ${st.name} bar`, side(east, 0.5, 1.1), st.y + 2.5, 1.1, 5, 1.15, true, STAND_H))
    // railings on the open edges, with a gap where the stair lands
    const edge = east ? 100 - STAND_W : STAND_W
    out.push(railAt('Stand railing', p(edge, st.y), p(edge, st.stairY), STAND_H))
    out.push(railAt('Stand railing', p(edge, st.stairY + STAIR_W), p(edge, st.y + st.h), STAND_H))
    out.push(railAt('Stand railing', p(side(east, 0, STAND_W), st.y), p(side(east, 0, STAND_W) + STAND_W, st.y), STAND_H))
    out.push(railAt('Stand railing', p(side(east, 0, STAND_W), st.y + st.h), p(side(east, 0, STAND_W) + STAND_W, st.y + st.h), STAND_H))
  }
  return out
}

function standPlatforms(): Platform[] {
  return ['W', 'E'].flatMap((sd) =>
    STANDS.map((st) => ({
      platformId: `P-${sd}${st.key}`,
      name: `${sd === 'W' ? 'West' : 'East'} Stand ${st.name}`,
      polygon: rect(side(sd === 'E', 0, STAND_W), st.y, STAND_W, st.h),
      elevationM: STAND_H,
      zoneId: `${sd}${st.key}`,
    })),
  )
}

function standStairs(): Stair[] {
  return ['W', 'E'].flatMap((sd) =>
    STANDS.map((st) => {
      const east = sd === 'E'
      const topX = east ? 100 - STAND_W : STAND_W
      const bottomX = east ? topX - STAIR_LEN : topX + STAIR_LEN
      const cy = st.stairY + STAIR_W / 2
      return {
        stairId: `ST-${sd}${st.key}`,
        name: `${east ? 'East' : 'West'} Stand ${st.name} stairs`,
        polygon: rect(Math.min(topX, bottomX), st.stairY, STAIR_LEN, STAIR_W),
        bottom: p(bottomX, cy),
        top: p(topX, cy),
        topElevationM: STAND_H,
        platformId: `P-${sd}${st.key}`,
      }
    }),
  )
}

/** Thin side walls that keep the stairs a closed lane, for the crowd model. */
function stairRails() {
  return standStairs().flatMap((s, k) => {
    const b = s.polygon
    const x = Math.min(b[0].x, b[2].x)
    const y = Math.min(b[0].y, b[2].y)
    return [
      { obstacleId: `STR-${k}-a`, name: 'Stair rail', kind: 'wall' as const, polygon: rect(x, y - 0.15, STAIR_LEN, 0.15) },
      { obstacleId: `STR-${k}-b`, name: 'Stair rail', kind: 'wall' as const, polygon: rect(x, y + STAIR_W, STAIR_LEN, 0.15) },
    ]
  })
}

const structures: Structure[] = [
  // stage
  box('stage', 'Main Stage deck', 30, 0.6, 40, 6.4, 1.6),
  box('speaker', 'PA left', 27.3, 2.6, 1.8, 4, 7.5),
  box('speaker', 'PA right', 70.9, 2.6, 1.8, 4, 7.5),
  box('container', 'Production container', 2, 1.2, 6, 2.4, 2.6),
  box('container', 'Production container', 10, 1.2, 6, 2.4, 2.6),
  box('container', 'Dressing rooms', 19, 1.2, 8, 3, 2.8),
  box('container', 'Production container', 74, 1.2, 6, 2.4, 2.6),
  box('container', 'Production container', 84, 1.2, 6, 2.4, 2.6),
  box('container', 'Generator', 92, 1.2, 5, 2.4, 2.2),
  run('barrier', 'Front-of-stage barricade', p(28, 7.6), p(72, 7.6), 1.2, 0.35),
  // floor
  box('tower', 'Delay tower west', 23.4, 23.4, 1.2, 1.2, 8.5),
  box('tower', 'Delay tower east', 75.4, 23.4, 1.2, 1.2, 8.5),
  box('tent', 'FOH', 46, 31, 8, 5, 3.2),
  // side stands: raised terraces either side of the side exits, reached by stairs from the floor
  ...standStructures('West', false),
  ...standStructures('East', true),
  // passage walls and the closed centre passage
  box('wall', 'Passage wall', 0, 40, 20.5, 3, 3.2),
  box('wall', 'Passage wall', 24.5, 40, 21.5, 3, 3.2),
  box('barrier', 'Centre Passage, closed', 46, 40.9, 8, 1.2, 1.1),
  box('wall', 'Passage wall', 54, 40, 18, 3, 3.2),
  box('wall', 'Passage wall', 80, 40, 20, 3, 3.2),
  // concourse
  box('pole', 'CAM-02 pole', 35.8, 52.3, 0.4, 0.4, 5),
  // food court
  box('truck', 'Tacos', 39, 60.4, 5.6, 2.6, 3),
  box('truck', 'Noodles', 45.6, 60.4, 5.6, 2.6, 3),
  box('truck', 'Coffee', 52.2, 60.4, 5.6, 2.6, 3),
  ...[40.5, 44, 47.5, 51, 54.5, 58].flatMap((tx) => [
    box('table', 'Picnic table', tx, 54.6, 2, 0.9, 0.75),
    box('table', 'Picnic table', tx, 57.2, 2, 0.9, 0.75),
  ]),
  // facilities
  box('tent', 'First Aid', 1, 54, 8, 8, 3.2),
  box('tent', 'Merch', 91, 54, 8, 4.2, 3),
  box('counter', 'Merch counter', 91, 58.8, 8, 0.8, 1.1),
  box('block', 'Toilets', 84, 59, 5, 4.5, 2.6),
  // gate queue lanes
  ...[20, 22, 24, 26, 28].map((lx) => run('barrier', 'Gate A lane', p(lx, 60), p(lx, 63.6), 1, 0.15)),
  ...[72, 74, 76, 78, 80].map((lx) => run('barrier', 'Gate B lane', p(lx, 60), p(lx, 63.6), 1, 0.15)),
  // perimeter fence, open at the exits and gates
  run('wall', 'Stand back wall', p(0, 7), p(0, 20), STAND_H + 1.2),
  run('wall', 'Stand back wall', p(0, 26), p(0, 40), STAND_H + 1.2),
  run('fence', 'Perimeter', p(0, 43), p(0, 53), 2.4),
  run('wall', 'Stand back wall', p(100, 7), p(100, 20), STAND_H + 1.2),
  run('wall', 'Stand back wall', p(100, 26), p(100, 40), STAND_H + 1.2),
  run('fence', 'Perimeter', p(100, 43), p(100, 53), 2.4),
  run('fence', 'Perimeter', p(10, 64), p(20, 64), 2.4),
  run('fence', 'Perimeter', p(28, 64), p(72, 64), 2.4),
  run('fence', 'Perimeter', p(80, 64), p(90, 64), 2.4),
]

export const venue: Venue = {
  venueId: 'main-stage',
  name: 'Main Stage',
  width: W,
  height: H,
  coordinateSystem: { units: 'm', origin: 'top-left', xAxis: 'east', yAxis: 'south' },
  timeZone: 'America/Los_Angeles',
  zones: [
    zone('FL', 'Front Left', 'front', 10, 7, 40, 10),
    zone('FR', 'Front Right', 'front', 50, 7, 40, 10),
    // FOH and the delay towers sit on the floor; each side loses about 22 m².
    zone('ML', 'Main Left', 'floor', 10, 17, 40, 23, 22),
    zone('MR', 'Main Right', 'floor', 50, 17, 40, 23, 22),
    // the wings are mostly stands now; the ground keeps the side-exit plaza and a strip by the stands
    zone('WW', 'West Wing', 'wing', 0, 7, 10, 33, 197),
    zone('EW', 'East Wing', 'wing', 90, 7, 10, 33, 197),
    zone('WN', 'West Stand North', 'wing', 0, 8.5, STAND_W, 11, 5.5, STAND_H),
    zone('WS', 'West Stand South', 'wing', 0, 26.5, STAND_W, 11.5, 5.5, STAND_H),
    zone('EN', 'East Stand North', 'wing', 100 - STAND_W, 8.5, STAND_W, 11, 5.5, STAND_H),
    zone('ES', 'East Stand South', 'wing', 100 - STAND_W, 26.5, STAND_W, 11.5, 5.5, STAND_H),
    zone('CW', 'Concourse West', 'concourse', 0, 43, 50, 10),
    zone('CE', 'Concourse East', 'concourse', 50, 43, 50, 10),
    zone('GA', 'Gate A Plaza', 'plaza', 10, 53, 28, 11, 4),
    zone('FC', 'Food Court', 'food', 38, 53, 24, 11, 69),
    zone('GB', 'Gate B Plaza', 'plaza', 62, 53, 28, 11, 26),
    zone('WP', 'West Passage', 'passage', 20.5, 40, 4, 3),
    zone('EP', 'East Passage', 'passage', 72, 40, 8, 3),
  ],
  walkways: [
    { walkwayId: 'WP', name: 'West Passage', polygon: rect(20.5, 40, 4, 3), status: 'open', widthM: 4 },
    { walkwayId: 'CP', name: 'Centre Passage', polygon: rect(46, 40, 8, 3), status: 'closed', widthM: 8 },
    { walkwayId: 'EP', name: 'East Passage', polygon: rect(72, 40, 8, 3), status: 'open', widthM: 8 },
  ],
  exits: [
    { exitId: 'EX-W', name: 'West Exit', kind: 'exit', segment: [p(0, 20), p(0, 26)] },
    { exitId: 'EX-E', name: 'East Exit', kind: 'exit', segment: [p(W, 20), p(W, 26)] },
    { exitId: 'GATE-A', name: 'Gate A', kind: 'gate', segment: [p(20, H), p(28, H)] },
    { exitId: 'GATE-B', name: 'Gate B', kind: 'gate', segment: [p(72, H), p(80, H)] },
  ],
  stages: [
    {
      stageId: 'STAGE-1',
      name: 'Main Stage',
      polygon: rect(30, 0.6, 40, 6.4),
      deckHeightM: 1.6,
      ledWall: { from: p(33.8, 1.6), to: p(66.2, 1.6), bottomM: 2.2, topM: 7.6 },
      truss: [p(34, 7), p(42, 7), p(50, 7), p(58, 7), p(66, 7)],
      trussHeightM: 9.5,
      barricade: [p(28, 7.6), p(72, 7.6)],
    },
  ],
  structures,
  platforms: standPlatforms(),
  stairs: standStairs(),
  obstacles: [
    ...stairRails(),
    { obstacleId: 'BS-W', name: 'Backstage', kind: 'backstage', polygon: rect(0, 0, 30, 7) },
    { obstacleId: 'STAGE-1', name: 'Main Stage', kind: 'stage', polygon: rect(30, 0, 40, 7) },
    { obstacleId: 'BS-E', name: 'Backstage', kind: 'backstage', polygon: rect(70, 0, 30, 7) },
    { obstacleId: 'FA-POST', name: 'First Aid', kind: 'facility', polygon: rect(0, 53, 10, 11) },
    { obstacleId: 'MERCH', name: 'Merch', kind: 'facility', polygon: rect(90, 53, 10, 11) },
  ],
  cameraLocations: [
    { cameraId: 'CAM-01', name: 'CAM-01 · front of stage', position: p(6, 5), mountHeightM: 6, coverage: [p(7, 6.5), p(50, 7.5), p(50, 22), p(10, 22)] },
    { cameraId: 'CAM-02', name: 'CAM-02 · West Passage', position: p(36, 52.5), mountHeightM: 5, coverage: [p(14, 36), p(30, 36), p(36, 52), p(8, 52)] },
  ],
  stationLocations: [
    { stationId: 'GW-01', name: 'Gateway gw-01', kind: 'gateway', position: p(50, 30.5) },
    { stationId: 'ST-01', name: 'Anchor st-01', kind: 'anchor', position: p(22.5, 46) },
    { stationId: 'ST-02', name: 'Anchor st-02', kind: 'anchor', position: p(76, 46) },
    { stationId: 'ST-03', name: 'Anchor st-03', kind: 'anchor', position: p(31, 58) },
    { stationId: 'ST-04', name: 'Anchor st-04', kind: 'anchor', position: p(69, 58) },
    { stationId: 'ST-05', name: 'Anchor st-05', kind: 'anchor', position: p(10.5, 12) },
    { stationId: 'ST-06', name: 'Anchor st-06', kind: 'anchor', position: p(89.5, 12) },
    { stationId: 'FA-01', name: 'First Aid', kind: 'first_aid', position: p(10.3, 56) },
  ],
  responderCorridors: [
    corridor(
      'COR-FL-W',
      'First Aid to Front Left, through West Passage',
      [p(10.3, 56), p(14, 50), p(21.5, 45.2), p(22.5, 43.6), p(22.5, 39.4), p(25, 30), p(29.5, 20), p(31, 13.5)],
      ['FL', 'ML', 'WW', 'WP'],
      ['WP'],
    ),
    corridor('COR-CW', 'First Aid to Concourse West', [p(10.3, 56), p(13, 51.5), p(17, 48.5), p(26, 47.5)], ['CW', 'GA'], []),
    corridor(
      'COR-FR-E',
      'First Aid to Front Right, through East Passage',
      [p(10.3, 56), p(14, 50), p(30, 47.8), p(60, 47.8), p(75.5, 45), p(76, 39.4), p(72, 28), p(66, 13.5)],
      ['FR', 'MR', 'EW', 'EP', 'CE'],
      ['EP'],
    ),
  ],
  schedule: [SUPPORT, HEADLINER],
}
