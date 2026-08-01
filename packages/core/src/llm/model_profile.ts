import type { ModelProfileOverride, ProviderConfig } from '@memo/core/config/config'

/** Wire API kinds; the provider factory registry dispatches on these (future: responses / messages). */
export type ModelWireApi = 'chat_completions' | 'responses' | 'messages'

export type ModelProfile = {
    wireApi: ModelWireApi
    supportsParallelToolCalls: boolean
    supportsReasoningContent: boolean
    contextWindow?: number
    isFallback: boolean
}

type ProfileCapabilities = Omit<ModelProfile, 'wireApi' | 'isFallback'>

const CONSERVATIVE_FALLBACK_PROFILE: ProfileCapabilities = {
    supportsParallelToolCalls: false,
    supportsReasoningContent: false,
}

export type ResolvedModelProfile = {
    profile: ModelProfile
    warning?: string
}

function normalizeToken(value: string): string {
    return value.trim().toLowerCase()
}

function resolveOverride(
    providerName: string,
    modelSlug: string,
    overrides: Record<string, ModelProfileOverride> | undefined,
): ModelProfileOverride | undefined {
    if (!overrides) return undefined

    const normalizedOverrides = new Map<string, ModelProfileOverride>()
    for (const [key, value] of Object.entries(overrides)) {
        normalizedOverrides.set(normalizeToken(key), value)
    }

    const providerSpecific = normalizedOverrides.get(`${providerName}:${modelSlug}`)
    if (providerSpecific) return providerSpecific
    return normalizedOverrides.get(modelSlug)
}

function applyOverride(
    base: ProfileCapabilities,
    override: ModelProfileOverride | undefined,
): { capabilities: ProfileCapabilities; usedOverride: boolean } {
    if (!override) return { capabilities: base, usedOverride: false }

    const next: ProfileCapabilities = { ...base }
    let usedOverride = false

    if (typeof override.supports_parallel_tool_calls === 'boolean') {
        next.supportsParallelToolCalls = override.supports_parallel_tool_calls
        usedOverride = true
    }
    if (typeof override.supports_reasoning_content === 'boolean') {
        next.supportsReasoningContent = override.supports_reasoning_content
        usedOverride = true
    }
    if (
        typeof override.context_window === 'number' &&
        Number.isFinite(override.context_window) &&
        override.context_window > 0
    ) {
        next.contextWindow = Math.floor(override.context_window)
        usedOverride = true
    }

    return { capabilities: next, usedOverride }
}

export function resolveModelProfile(
    provider: Pick<ProviderConfig, 'name' | 'model'>,
    overrides?: Record<string, ModelProfileOverride>,
): ResolvedModelProfile {
    const providerName = normalizeToken(provider.name)
    const modelSlug = normalizeToken(provider.model)
    const { capabilities, usedOverride } = applyOverride(
        CONSERVATIVE_FALLBACK_PROFILE,
        resolveOverride(providerName, modelSlug, overrides),
    )

    return {
        profile: {
            wireApi: 'chat_completions',
            ...capabilities,
            isFallback: !usedOverride,
        },
    }
}
