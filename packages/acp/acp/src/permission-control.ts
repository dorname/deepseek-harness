/** Standard ACP session configuration over one Agent's approval policy and permission presets. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
// Side-effect type import: declares the optional `approval` service this control reads.
import type {} from '@deepseek-ai/dsh-user-approval'
import { APPROVAL_POLICIES, type ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

const POLICY_CONFIG_ID = 'permission_policy'
const PRESET_CONFIG_ID = 'permission_preset'

/** Human-readable labels for the advertised policy select values. */
const POLICY_LABELS: Record<ApprovalPolicy, string> = {
  ask: 'Ask for permission',
  never: 'Never ask (auto-reject)',
  always: 'Always ask before every tool call',
}

/** Runtime guard for the opaque `permission_policy` select value. */
function isApprovalPolicy(value: unknown): value is ApprovalPolicy {
  return typeof value === 'string' && (APPROVAL_POLICIES as readonly string[]).includes(value)
}

/** Caller-correctable session permission configuration failure. */
export class AcpPermissionConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpPermissionConfigError'
  }
}

/**
 * Project and mutate one Agent's approval policy and permission preset through
 * ACP config options. Services are read opportunistically with `ctx.get` at
 * call time: a deployment that composes neither advertises no permission
 * options, and setting one fails with a caller-correctable error instead of
 * silently falling back.
 */
export class AcpPermissionControl {
  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
  ) {}

  /** Whether {@link set} handles this option id (the bridge routes before model options). */
  owns(configId: string): boolean {
    return configId === POLICY_CONFIG_ID || configId === PRESET_CONFIG_ID
  }

  /**
   * Return the permission config options after the prior mutation settles.
   * @returns the policy option (approval service composed) plus the preset
   *   option (preset service composed), in that order.
   */
  options(): SessionConfigOption[] {
    const approval = this.ctx.get('approval')
    const presets = this.ctx.get('permissionPresets')
    const options: SessionConfigOption[] = []
    if (approval !== undefined) {
      options.push({
        id: POLICY_CONFIG_ID,
        name: 'Permission policy',
        description: 'ask lets ask sources prompt, never auto-rejects every ask, always asks before every tool call.',
        category: 'mode',
        type: 'select',
        currentValue: approval.effectivePolicy(this.agent.session),
        options: APPROVAL_POLICIES.map(policy => ({ value: policy, name: POLICY_LABELS[policy] })),
      })
    }
    if (presets !== undefined) {
      options.push(this.presetOption(presets))
    }
    return options
  }

  /**
   * Set one advertised permission option.
   * @param configId - advertised option id.
   * @param value - opaque selected value from a previous option state.
   * @returns this control's resulting options (the session merges the model
   *   options around them).
   */
  set(configId: string, value: unknown): SessionConfigOption[] {
    if (configId === POLICY_CONFIG_ID) {
      const approval = this.ctx.get('approval')
      if (approval === undefined) {
        throw new AcpPermissionConfigError('permission policy is not available: no approval service is composed')
      }
      if (!isApprovalPolicy(value)) {
        throw new AcpPermissionConfigError(`unknown permission policy value: ${JSON.stringify(value)} (expected one of ${APPROVAL_POLICIES.join(', ')})`)
      }
      approval.setPolicy(this.agent, value)
    } else if (configId === PRESET_CONFIG_ID) {
      const presets = this.ctx.get('permissionPresets')
      if (presets === undefined) {
        throw new AcpPermissionConfigError('permission presets are not available: no preset service is composed')
      }
      if (typeof value !== 'string') throw new AcpPermissionConfigError('permission_preset requires a select value')
      if (!presets.names.includes(value)) {
        throw new AcpPermissionConfigError(`unknown permission preset "${value}" (available: ${presets.names.join(', ')})`)
      }
      presets.set(this.agent.session, value)
    } else {
      throw new AcpPermissionConfigError(`unknown session config option: ${configId}`)
    }
    return this.options()
  }

  /** Build the preset select: the live catalog with the session's derived current value. */
  private presetOption(presets: PermissionPresetService): SessionConfigOption {
    return {
      id: PRESET_CONFIG_ID,
      name: 'Permission preset',
      description: 'Bundles a sandbox mode and an approval policy; values come from the deployment’s preset table.',
      category: 'mode',
      type: 'select',
      currentValue: presets.current(this.agent.session),
      options: presets.catalog().options.map(option => ({
        value: option.value,
        name: option.name,
        ...option.description === undefined ? {} : { description: option.description },
      })),
    }
  }
}
