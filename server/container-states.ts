// Host-free, so it can be tested on its own: running `docker ps` is passed in.

/** Whether an Application's container can be browsed: it runs, it doesn't, or its host didn't answer. */
export type ContainerState = 'running' | 'stopped' | 'unreachable'

/** One container terminal to ask about: the Docker host it runs on, by a key, and the container. */
export interface ContainerProbe {
  ref: string
  host: string
  containerId: string
}

interface PsRow {
  id: string
  name: string
  state: string
}

/** Lines of `docker ps --format '{{.ID}}\t{{.Names}}\t{{.State}}'`. */
export const PS_FORMAT = '{{.ID}}\t{{.Names}}\t{{.State}}'

export function parseDockerPs(out: string): PsRow[] {
  return out
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [id = '', name = '', state = ''] = line.split('\t')
      return { id, name, state }
    })
}

// A container is named by its name or by its id, which `docker ps` prints
// shortened; one the host does not list at all has not been created yet.
function stateOf(rows: PsRow[], containerId: string): ContainerState {
  const row = rows.find(
    (r) => r.name === containerId || (r.id !== '' && (containerId.startsWith(r.id) || r.id.startsWith(containerId))),
  )
  return row?.state === 'running' ? 'running' : 'stopped'
}

/**
 * Each probe's container state, asking each Docker host once however many of
 * its containers are probed. A host whose `ps` fails makes all of its
 * containers `unreachable`, not stopped: nothing was learnt about them.
 */
export async function containerStates(
  probes: readonly ContainerProbe[],
  ps: (host: string) => Promise<string>,
): Promise<Record<string, ContainerState>> {
  const hosts = new Map<string, Promise<PsRow[] | undefined>>()
  for (const probe of probes) {
    if (!hosts.has(probe.host)) {
      hosts.set(
        probe.host,
        ps(probe.host).then(parseDockerPs, () => undefined),
      )
    }
  }
  const states: Record<string, ContainerState> = {}
  for (const probe of probes) {
    const rows = await hosts.get(probe.host)
    states[probe.ref] = rows ? stateOf(rows, probe.containerId) : 'unreachable'
  }
  return states
}
