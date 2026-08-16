#!/usr/bin/env node
import Pastel from 'pastel'
import { patchStdinForModifiedKeys } from './shared/lib/inputCompat'

patchStdinForModifiedKeys()

const app = new Pastel({
    name: 'memo',
    description: 'A lightweight coding agent for terminal workflows',
    importMeta: import.meta,
})

await app.run()
