import { createFileRoute } from '@tanstack/react-router'
import { PoolPage } from '@/features/pool'

export const Route = createFileRoute('/_authenticated/pool')({
  component: PoolPage,
})
