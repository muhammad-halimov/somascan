import { useMemo } from 'react'
import { useSettings } from '@/features/settings/store/useSettings'
import { uploadStore } from '@/features/uploads/queue/appQueue'
import { useStore } from '@/lib/store/useStore'
import { heatDuplicates, type HeatDuplicate } from '../utils/sendReadiness'
import type { ScanItem } from './useScanSession'

/** Повторов нет: правило «каждая плавка — один раз» выключено. */
const NONE: ReadonlyMap<string, HeatDuplicate> = new Map()

/**
 * Повторы плавок у бирок на экране — с биркой раньше или с записью в «Загрузках» (`heatDuplicates`);
 * пусто, если в настройках хранилища выключено «Каждая плавка — один раз».
 */
export function useHeatDuplicates(items: readonly ScanItem[]) {
  const { storage } = useSettings()
  const records = useStore(uploadStore)
  return useMemo(() => (storage.uniqueHeat ? heatDuplicates(items, records) : NONE), [storage.uniqueHeat, items, records])
}
