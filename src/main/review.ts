import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import {
  isReviewCommitRequest,
  isReviewDiffRequest,
  isReviewFileRequest,
  isReviewRequest,
  isReviewRootRequest
} from '../shared/review'
import { ownedTerminalCwd } from './pty'
import {
  reviewCommit,
  reviewDiff,
  reviewPullRequestDiff,
  reviewStage,
  reviewStatus,
  reviewTest,
  reviewUnstage
} from './reviewGit'

export function registerReviewIpc(): void {
  ipcMain.handle(IPC.REVIEW_STATUS, (event, request: unknown) => {
    if (!isReviewRequest(request)) throw new Error('Invalid review request')
    const cwd = ownedTerminalCwd(event.sender, request.surfaceId)
    if (!cwd) throw new Error('The terminal is no longer available')
    return reviewStatus(cwd)
  })
  ipcMain.handle(IPC.REVIEW_DIFF, (event, request: unknown) => {
    if (!isReviewDiffRequest(request)) throw new Error('Invalid diff request')
    const cwd = ownedTerminalCwd(event.sender, request.surfaceId)
    if (!cwd) throw new Error('The terminal is no longer available')
    return reviewDiff(cwd, request)
  })
  ipcMain.handle(IPC.REVIEW_STAGE, (event, request: unknown) => {
    if (!isReviewFileRequest(request)) throw new Error('Invalid stage request')
    const cwd = ownedTerminalCwd(event.sender, request.surfaceId)
    if (!cwd) throw new Error('The terminal is no longer available')
    return reviewStage(cwd, request)
  })
  ipcMain.handle(IPC.REVIEW_UNSTAGE, (event, request: unknown) => {
    if (!isReviewFileRequest(request)) throw new Error('Invalid unstage request')
    const cwd = ownedTerminalCwd(event.sender, request.surfaceId)
    if (!cwd) throw new Error('The terminal is no longer available')
    return reviewUnstage(cwd, request)
  })
  ipcMain.handle(IPC.REVIEW_COMMIT, (event, request: unknown) => {
    if (!isReviewCommitRequest(request)) throw new Error('Invalid commit request')
    const cwd = ownedTerminalCwd(event.sender, request.surfaceId)
    if (!cwd) throw new Error('The terminal is no longer available')
    return reviewCommit(cwd, request)
  })
  ipcMain.handle(IPC.REVIEW_TEST, (event, request: unknown) => {
    if (!isReviewRootRequest(request)) throw new Error('Invalid test request')
    const cwd = ownedTerminalCwd(event.sender, request.surfaceId)
    if (!cwd) throw new Error('The terminal is no longer available')
    return reviewTest(cwd, request)
  })
  ipcMain.handle(IPC.REVIEW_PR_DIFF, (event, request: unknown) => {
    if (!isReviewRootRequest(request)) throw new Error('Invalid pull request diff request')
    const cwd = ownedTerminalCwd(event.sender, request.surfaceId)
    if (!cwd) throw new Error('The terminal is no longer available')
    return reviewPullRequestDiff(cwd, request)
  })
}
