import { describe as group, expect, it } from 'vitest'
import { adjacency, buildGraph, cluster, describe, named, neighbourhood, type Labels } from '@/components/desk/graphModel'
import type { GraphLink } from '@/stdb/catalog'

const link = (id: string, kind: string, from: string, to: string, weight = 1): GraphLink => {
  const [fromKind, fromId] = from.split(':')
  const [toKind, toId] = to.split(':')
  return { id, kind, fromKind, fromId, toKind, toId, weight }
}

const labels: Labels = {
  person: new Map([
    ['1', 'Maya Chen'],
    ['2', 'Sam Ortiz'],
  ]),
  booth: new Map([
    ['10', 'Figma booth'],
    ['11', 'Visa booth'],
  ]),
  company: new Map([['20', 'Figma']]),
}

const rows = [
  link('a', 'visited', 'person:1', 'booth:10', 12),
  link('b', 'visited', 'person:1', 'booth:11', 30),
  link('c', 'met', 'person:1', 'person:2', 9),
  link('d', 'works_at', 'person:1', 'company:20'),
  link('e', 'exhibits', 'company:20', 'booth:10'),
  link('f', 'visited', 'person:3', 'booth:11', 4),
]

const empty = { nodes: new Map(), links: new Map() }

group('event graph model', () => {
  it('builds every node with its name, and a placeholder for people without one', () => {
    const built = buildGraph(rows, labels, empty, 0)
    expect(built.changed).toBe(true)
    expect(built.nodes.size).toBe(6)
    expect(built.links.size).toBe(6)
    expect(built.nodes.get('booth:10')?.label).toBe('Figma booth')
    expect(built.nodes.get('person:3')?.label).toBe('Unnamed attendee')
    expect(named(built.nodes.get('person:3')!)).toBe(false)
    expect(named(built.nodes.get('person:1')!)).toBe(true)
  })

  it('keeps node objects, and so their positions, across rebuilds', () => {
    const first = buildGraph(rows, labels, empty, 0)
    Object.assign(first.nodes.get('person:1')!, { x: 5, y: 6, z: 7 })
    const same = buildGraph(rows, labels, first, 100)
    expect(same.changed).toBe(false)
    expect(same.nodes.get('person:1')).toBe(first.nodes.get('person:1'))
    const grown = buildGraph([...rows, link('g', 'met', 'person:4', 'person:1')], labels, first, 100)
    expect(grown.changed).toBe(true)
    expect(grown.nodes.get('person:4')).toMatchObject({ born: 100 })
    // A newcomer starts beside the node it links to.
    expect(Math.abs((grown.nodes.get('person:4')?.x ?? 99) - 5)).toBeLessThanOrEqual(5)
  })

  it('notices a company renamed after its first link', () => {
    const first = buildGraph(rows, labels, empty, 0)
    const renamed = buildGraph(rows, { ...labels, company: new Map([['20', 'Figma Inc']]) }, first, 1)
    expect(renamed.changed).toBe(false)
    expect(renamed.renamed).toBe(true)
    expect(renamed.nodes.get('company:20')?.label).toBe('Figma Inc')
  })

  it('skips rows whose ends are not people, booths or companies', () => {
    const built = buildGraph([link('x', 'in_photo', 'photo:1', 'person:1')], labels, empty, 0)
    expect(built.nodes.size).toBe(0)
  })

  it("describes a person by the booths they stood at, longest first, and who they met", () => {
    const built = buildGraph(rows, labels, empty, 0)
    const adjacent = adjacency(built.links.values())
    const summary = describe(built.nodes.get('person:1')!, adjacent, built.nodes)
    expect(summary.title).toBe('Maya Chen')
    expect(summary.eyebrow).toBe('Person · Figma')
    expect(summary.stats).toBe('Met 1 person · visited 2 booths')
    expect(summary.sections[0].title).toBe('Booths visited')
    expect(summary.sections[0].items.map((item) => [item.label, item.note])).toEqual([
      ['Visa booth', '30 min'],
      ['Figma booth', '12 min'],
    ])
    expect(summary.sections[1].items[0]).toMatchObject({ label: 'Sam Ortiz', kind: 'person' })
    expect(neighbourhood('person:1', adjacent)).toEqual(new Set(['person:1', 'booth:10', 'booth:11', 'person:2', 'company:20']))
  })

  it('describes booths and companies by their visitors, booths and people', () => {
    const built = buildGraph(rows, labels, empty, 0)
    const adjacent = adjacency(built.links.values())
    const booth = describe(built.nodes.get('booth:11')!, adjacent, built.nodes)
    expect(booth.stats).toBe('2 visitors')
    expect(booth.sections.map((s) => s.title)).toEqual(['Visitors'])
    const company = describe(built.nodes.get('company:20')!, adjacent, built.nodes)
    expect(company.stats).toBe('1 person works here · 1 booth')
    expect(company.sections.map((s) => s.title)).toEqual(['Booths', 'People'])
  })

  it('colours by company and by memories, naming each group', () => {
    const built = buildGraph(rows, labels, empty, 0)
    const colours = new Map<string, string>()
    const byCompany = cluster('company', built.nodes, built.links, colours)
    expect(byCompany.groups.get('person:1')).toBe('company:20')
    expect(byCompany.legend).toEqual([{ colour: colours.get('company:20'), label: 'Figma · 1 person' }])

    const memories = cluster('memories', built.nodes, built.links, new Map())
    expect(memories.groups.get('person:1')).toBe(memories.groups.get('person:2'))
    expect(memories.legend[0].label).toMatch(/^Around .+ · \d+ people$/)
    expect(cluster('kind', built.nodes, built.links, new Map()).legend).toEqual([])
  })
})
