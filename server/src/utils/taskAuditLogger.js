import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultLogFilePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../logs/tripo-task-audit.ndjson',
)

const serializeError = (error) => ({
  name: error?.name || 'Error',
  message: error?.message || 'Unknown error',
})

export const createTaskAuditLogger = ({
  logFilePath = defaultLogFilePath,
  now = () => new Date(),
} = {}) => {
  const writeEntry = async (entry) => {
    try {
      await mkdir(path.dirname(logFilePath), { recursive: true })
      await appendFile(
        logFilePath,
        `${JSON.stringify({
          timestamp: now().toISOString(),
          ...entry,
        })}\n`,
        'utf8',
      )
    } catch (error) {
      console.error('Failed to write Tripo audit log.', error)
    }
  }

  return {
    logFilePath,
    async findSubmissionByTaskId(taskId) {
      const normalizedTaskId = String(taskId || '').trim()
      if (!normalizedTaskId) {
        return null
      }

      try {
        const rawLog = await readFile(logFilePath, 'utf8')
        const lines = rawLog
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)

        for (let index = lines.length - 1; index >= 0; index -= 1) {
          try {
            const entry = JSON.parse(lines[index])
            if (entry?.event === 'tripo-task-submission' && entry?.taskId === normalizedTaskId) {
              return entry
            }
          } catch {
            // Ignore malformed log entries and continue scanning older rows.
          }
        }
      } catch {
        return null
      }

      return null
    },
    async logSubmission({
      action,
      path: requestPath,
      baseUrl,
      requestBody,
      responseBody,
      taskId,
    }) {
      await writeEntry({
        event: 'tripo-task-submission',
        action,
        path: requestPath,
        baseUrl,
        taskId,
        requestBody,
        responseBody,
      })
    },
    async logFailure({
      action,
      path: requestPath,
      baseUrl,
      requestBody,
      error,
    }) {
      await writeEntry({
        event: 'tripo-task-submission-failed',
        action,
        path: requestPath,
        baseUrl,
        requestBody,
        error: serializeError(error),
      })
    },
  }
}
