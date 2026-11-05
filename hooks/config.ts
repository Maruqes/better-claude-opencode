import type { Effort } from '../types'

export type EffortEntry = { model: string; variant: string }

export type EffortConfig = {
  enabled: boolean
  // The model and requested variant each effort asks for. The variant is resolved
  // against `variants` before it is passed to the MCP.
  table: Record<Effort, EffortEntry>
  // The native variants each opencode model supports. A model left out passes the
  // requested variant through unchanged.
  variants: Record<string, string[]>
}

export type MonitorConfig = { effort: EffortConfig }

export const EFFORTS: Effort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export const DEFAULT_CONFIG: MonitorConfig = {
  effort: {
    enabled: true,
    table: {
      minimal: { model: 'opencode-go/deepseek-v4.1-flash', variant: 'low' },
      low: { model: 'opencode-go/deepseek-v4.1-flash', variant: 'low' },
      medium: { model: 'opencode-go/glm-5.3-flash', variant: 'medium' },
      high: { model: 'opencode-go/deepseek-v4-pro', variant: 'high' },
      xhigh: { model: 'opencode-go/kimi-k3.1-pro', variant: 'xhigh' },
      max: { model: 'opencode-go/kimi-k3.1-pro', variant: 'max' },
    },
    variants: {
      'deepseek-v4.1-flash': ['low', 'high', 'max'],
      'glm-5.3-flash': ['low', 'high', 'max'],
      'deepseek-v4-pro': ['high', 'max'],
      'kimi-k3.1-pro': ['low', 'high', 'max'],
      'qwen3.8-flash': ['low', 'medium', 'xhigh'],
      'qwen3.8-max': ['low', 'medium', 'xhigh'],
      'minimax-m3.1-flash': ['low', 'medium', 'high', 'xhigh', 'max'],
      'gpt-6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
    },
  },
}

type Reader = {
  fs: {
    exists(path: string): Promise<boolean>
    read(path: string): Promise<string>
  }
  session: { root(): Promise<string> }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isEntry = (value: unknown): value is EffortEntry =>
  isRecord(value) && typeof value.model === 'string' && value.model.trim() !== '' && typeof value.variant === 'string'

// Parses one config file. A bad section is ignored with a warning; a good part
// still applies, so one typo never throws away the rest.
export const configFromText = (text: string): { config: MonitorConfig; warning?: string } => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { config: DEFAULT_CONFIG, warning: `invalid JSON: ${message(error)}` }
  }
  if (!isRecord(raw)) return { config: DEFAULT_CONFIG, warning: 'the file must hold a JSON object' }

  const effort = isRecord(raw.effort) ? raw.effort : {}
  const config: MonitorConfig = {
    effort: {
      enabled: DEFAULT_CONFIG.effort.enabled,
      table: { ...DEFAULT_CONFIG.effort.table },
      variants: { ...DEFAULT_CONFIG.effort.variants },
    },
  }
  const problems: string[] = []

  if (raw.effort !== undefined && !isRecord(raw.effort)) problems.push('effort must be an object')

  if (effort.enabled !== undefined) {
    if (typeof effort.enabled === 'boolean') config.effort.enabled = effort.enabled
    else problems.push('effort.enabled must be true or false')
  }
  if (effort.table !== undefined) {
    if (!isRecord(effort.table)) problems.push('effort.table must be an object')
    else {
      for (const effortName of EFFORTS) {
        const entry = effort.table[effortName]
        if (entry === undefined) continue
        if (isEntry(entry)) config.effort.table[effortName] = { model: entry.model, variant: entry.variant }
        else problems.push(`effort.table.${effortName} needs a model and a variant`)
      }
    }
  }
  if (effort.variants !== undefined) {
    if (!isRecord(effort.variants)) problems.push('effort.variants must be an object')
    else {
      for (const [model, variants] of Object.entries(effort.variants)) {
        if (Array.isArray(variants) && variants.every(v => typeof v === 'string' && v !== '')) {
          config.effort.variants[model] = variants
        } else problems.push(`effort.variants.${model} must be a list of variant names`)
      }
    }
  }

  return problems.length ? { config, warning: problems.join('; ') } : { config }
}

// Reads `<project root>/.opencode-monitor/config.json`. A missing file is normal;
// any other failure is a warning and the defaults stay in force.
export async function loadConfig($: Reader): Promise<{ config: MonitorConfig; warning?: string }> {
  try {
    const path = `${await $.session.root()}/.opencode-monitor/config.json`
    let exists = false
    try {
      exists = await $.fs.exists(path)
    } catch {
      // No readable file system here is the same as no config file.
      return { config: DEFAULT_CONFIG }
    }
    if (!exists) return { config: DEFAULT_CONFIG }

    return configFromText(await $.fs.read(path))
  } catch (error) {
    return { config: DEFAULT_CONFIG, warning: message(error) }
  }
}
