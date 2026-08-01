import { describe, expect, test } from 'vitest'
import { NativeToolRegistry } from './index'

describe('NativeToolRegistry', () => {
    test('register adds tool', () => {
        const registry = new NativeToolRegistry()
        registry.register({
            name: 'test_tool',
            description: 'Test',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async () => ({ content: [] }),
        })

        expect(registry.has('test_tool')).toBe(true)
        expect(registry.get('test_tool')).toBeDefined()
    })

    test('registerMany adds multiple tools', () => {
        const registry = new NativeToolRegistry()
        registry.registerMany([
            {
                name: 'tool1',
                description: '1',
                source: 'native',
                inputSchema: {},
                execute: async () => ({ content: [] }),
            },
            {
                name: 'tool2',
                description: '2',
                source: 'native',
                inputSchema: {},
                execute: async () => ({ content: [] }),
            },
        ])

        expect(registry.has('tool1')).toBe(true)
        expect(registry.has('tool2')).toBe(true)
    })

    test('getAll returns all tools', () => {
        const registry = new NativeToolRegistry()
        registry.register({
            name: 'test',
            description: 'Test',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async () => ({ content: [] }),
        })

        expect(registry.getAll().length).toBe(1)
    })

    test('toRegistry returns correct format', () => {
        const registry = new NativeToolRegistry()
        registry.register({
            name: 'test',
            description: 'Test',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async () => ({ content: [] }),
        })

        const reg = registry.toRegistry()
        expect(reg.test).toBeDefined()
    })

    test('size returns correct count', () => {
        const registry = new NativeToolRegistry()
        expect(registry.size).toBe(0)

        registry.register({
            name: 'test',
            description: 'Test',
            source: 'native',
            inputSchema: { type: 'object' },
            execute: async () => ({ content: [] }),
        })

        expect(registry.size).toBe(1)
    })
})
