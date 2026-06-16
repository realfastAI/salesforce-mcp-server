#!/usr/bin/env tsx
/*
 * Packages the compiled server into a distributable .mcpb bundle (ZIP archive).
 *
 * Usage:
 *   npm run build:mcpb          — compiles TypeScript then packages
 *   npm run package:mcpb        — packages an already-compiled dist/ (skips tsc)
 *
 * Output: salesforce-mcp-server-<version>.mcpb in the project root.
 */

import archiver from 'archiver'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(__dirname, '..')

const skipBuild = process.argv.includes('--no-build')

// ── resolve version from manifest ────────────────────────────────────────────

const require = createRequire(import.meta.url)
const manifest = require('../manifest.json') as { name: string; version: string }
const outputName = `${manifest.name}-${manifest.version}.mcpb`
const outputPath = resolve(projectRoot, outputName)

// ── step 1: compile TypeScript ────────────────────────────────────────────────

if (!skipBuild) {
  console.log('Building TypeScript...')
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' })
}

const distDir = resolve(projectRoot, 'dist')
if (!existsSync(distDir)) {
  console.error('dist/ not found — run `npm run build` first or use `npm run build:mcpb`')
  process.exit(1)
}

// ── step 2: create staging dir with production-only node_modules ──────────────

const stageDir = resolve(projectRoot, '.mcpb-stage')

console.log('Preparing staging directory...')
rmSync(stageDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })

copyFileSync(resolve(projectRoot, 'package.json'), resolve(stageDir, 'package.json'))
copyFileSync(resolve(projectRoot, 'package-lock.json'), resolve(stageDir, 'package-lock.json'))
execSync('npm ci --omit=dev', { cwd: stageDir, stdio: 'inherit' })

// ── step 3: zip manifest + dist + staged node_modules ─────────────────────────

console.log(`Creating ${outputName}...`)

const output = createWriteStream(outputPath)
const archive = archiver('zip', { zlib: { level: 9 } })

await new Promise<void>((res, rej) => {
  output.on('close', res)
  archive.on('error', rej)

  archive.pipe(output)

  archive.file(resolve(projectRoot, 'manifest.json'), { name: 'manifest.json' })
  archive.directory(distDir, 'dist')
  archive.directory(resolve(stageDir, 'node_modules'), 'node_modules')

  void archive.finalize()
})

// ── step 4: clean up staging dir ─────────────────────────────────────────────

rmSync(stageDir, { recursive: true, force: true })

const bytes = output.bytesWritten
console.log(`Done: ${outputName} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
