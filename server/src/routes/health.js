import { Router } from 'express'

export const createHealthRouter = ({ config } = {}) => {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      versions: {
        tripoModelVersion: config?.tripoModelVersion || '',
        tripoRigModelVersion: config?.tripoRigModelVersion || '',
      },
    })
  })

  return router
}
