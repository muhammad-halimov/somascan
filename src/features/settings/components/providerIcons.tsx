import type { ReactNode } from 'react'
import { ClaudeLogo, GoogleLogo, LMStudioLogo, OpenAILogo } from '@/components/icons/Icons'
import type { ProviderId } from '@/features/recognition/types'

/** Логотипы провайдеров для вкладок и списков в настройках. */
export const PROVIDER_ICONS: Record<ProviderId, ReactNode> = {
  google: <GoogleLogo />,
  anthropic: <ClaudeLogo />,
  openai: <OpenAILogo />,
  lmstudio: <LMStudioLogo />,
}
