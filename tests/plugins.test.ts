import { describe, test, expect, vi, beforeEach } from 'vitest';
import { PluginManager } from '../src/plugins';
import type { HustlePlugin, ToolCall, HustleRequest, ProcessedResponse } from '../src/types';

// Extended HustleRequest for testing hooks that add properties
type TestHustleRequest = HustleRequest & Record<string, unknown>;

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  describe('plugin registration', () => {
    test('should register a valid plugin', async () => {
      const plugin: HustlePlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
        executors: {
          test_tool: async () => 'result',
        },
      };

      await manager.register(plugin);

      expect(manager.hasPlugin('test-plugin')).toBe(true);
      expect(manager.pluginCount).toBe(1);
      expect(manager.toolCount).toBe(1);
    });

    test('should call onRegister hook', async () => {
      const onRegister = vi.fn();
      const plugin: HustlePlugin = {
        name: 'hook-plugin',
        version: '1.0.0',
        hooks: { onRegister },
      };

      await manager.register(plugin);

      expect(onRegister).toHaveBeenCalledTimes(1);
    });

    test('should reject plugin without name', async () => {
      const plugin = {
        version: '1.0.0',
      } as HustlePlugin;

      await expect(manager.register(plugin)).rejects.toThrow('Plugin must have a name');
    });

    test('should reject plugin without version', async () => {
      const plugin = {
        name: 'no-version',
      } as HustlePlugin;

      await expect(manager.register(plugin)).rejects.toThrow('must have a version');
    });

    test('should reject duplicate plugin registration', async () => {
      const plugin: HustlePlugin = {
        name: 'duplicate-plugin',
        version: '1.0.0',
      };

      await manager.register(plugin);

      await expect(manager.register(plugin)).rejects.toThrow('already registered');
    });

    test('should reject invalid tool names', async () => {
      const plugin: HustlePlugin = {
        name: 'invalid-tool-plugin',
        version: '1.0.0',
        tools: [
          {
            name: '123_invalid', // starts with number
            description: 'Invalid tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      await expect(manager.register(plugin)).rejects.toThrow('Invalid tool name');
    });

    test('should reject tool names with special characters', async () => {
      const plugin: HustlePlugin = {
        name: 'special-char-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'my-tool', // hyphens not allowed
            description: 'Invalid tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      await expect(manager.register(plugin)).rejects.toThrow('Invalid tool name');
    });

    test('should reject executor without matching tool', async () => {
      const plugin: HustlePlugin = {
        name: 'orphan-executor-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'real_tool',
            description: 'A real tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
        executors: {
          fake_tool: async () => 'result', // no matching tool
        },
      };

      await expect(manager.register(plugin)).rejects.toThrow('no matching tool definition');
    });

    test('should reject tool name conflicts across plugins', async () => {
      const plugin1: HustlePlugin = {
        name: 'plugin1',
        version: '1.0.0',
        tools: [
          {
            name: 'shared_tool',
            description: 'Tool from plugin1',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      const plugin2: HustlePlugin = {
        name: 'plugin2',
        version: '1.0.0',
        tools: [
          {
            name: 'shared_tool', // same name as plugin1
            description: 'Tool from plugin2',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      await manager.register(plugin1);

      await expect(manager.register(plugin2)).rejects.toThrow('conflicts with tool from plugin');
    });
  });

  describe('plugin unregistration', () => {
    test('should unregister a plugin', async () => {
      const plugin: HustlePlugin = {
        name: 'removable-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'removable_tool',
            description: 'A removable tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };

      await manager.register(plugin);
      expect(manager.hasPlugin('removable-plugin')).toBe(true);

      await manager.unregister('removable-plugin');
      expect(manager.hasPlugin('removable-plugin')).toBe(false);
      expect(manager.toolCount).toBe(0);
    });

    test('should call onUnregister hook', async () => {
      const onUnregister = vi.fn();
      const plugin: HustlePlugin = {
        name: 'hook-unregister-plugin',
        version: '1.0.0',
        hooks: { onUnregister },
      };

      await manager.register(plugin);
      await manager.unregister('hook-unregister-plugin');

      expect(onUnregister).toHaveBeenCalledTimes(1);
    });

    test('should throw when unregistering unknown plugin', async () => {
      await expect(manager.unregister('unknown')).rejects.toThrow('not registered');
    });
  });

  describe('tool definitions', () => {
    test('should return all tool definitions', async () => {
      const plugin: HustlePlugin = {
        name: 'multi-tool-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'tool_one',
            description: 'First tool',
            parameters: { type: 'object', properties: {} },
          },
          {
            name: 'tool_two',
            description: 'Second tool',
            parameters: {
              type: 'object',
              properties: {
                input: { type: 'string', description: 'Input value' },
              },
              required: ['input'],
            },
          },
        ],
      };

      await manager.register(plugin);

      const definitions = manager.getClientToolDefinitions();
      expect(definitions).toHaveLength(2);
      expect(definitions.map((d) => d.name)).toEqual(['tool_one', 'tool_two']);
    });

    test('should return empty array when no plugins', () => {
      const definitions = manager.getClientToolDefinitions();
      expect(definitions).toEqual([]);
    });
  });

  describe('tool execution', () => {
    test('should execute a tool', async () => {
      const plugin: HustlePlugin = {
        name: 'executable-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'echo_tool',
            description: 'Echo input',
            parameters: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
            },
          },
        ],
        executors: {
          echo_tool: async (args: Record<string, unknown>) => `Echo: ${args.message}`,
        },
      };

      await manager.register(plugin);

      const toolCall: ToolCall = {
        toolCallId: 'call-1',
        toolName: 'echo_tool',
        args: { message: 'Hello' },
      };

      const result = await manager.executeClientTool(toolCall);
      expect(result).toBe('Echo: Hello');
    });

    test('should handle toolCall with alternative field names', async () => {
      const plugin: HustlePlugin = {
        name: 'compat-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'compat_tool',
            description: 'Compatibility tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
        executors: {
          compat_tool: async (args: Record<string, unknown>) => args,
        },
      };

      await manager.register(plugin);

      // Use alternative field names (name instead of toolName, arguments instead of args)
      const toolCall = {
        id: 'call-2',
        name: 'compat_tool',
        arguments: { foo: 'bar' },
      } as unknown as ToolCall;

      const result = await manager.executeClientTool(toolCall);
      expect(result).toEqual({ foo: 'bar' });
    });

    test('should throw when no executor found', async () => {
      const toolCall: ToolCall = {
        toolCallId: 'call-3',
        toolName: 'nonexistent_tool',
        args: {},
      };

      await expect(manager.executeClientTool(toolCall)).rejects.toThrow('No executor found');
    });

    test('should allow re-registering plugin after unregister', async () => {
      const plugin: HustlePlugin = {
        name: 'reusable-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'reusable_tool',
            description: 'A reusable tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
        executors: {
          reusable_tool: async () => 'first',
        },
      };

      await manager.register(plugin);
      expect(manager.hasPlugin('reusable-plugin')).toBe(true);

      await manager.unregister('reusable-plugin');
      expect(manager.hasPlugin('reusable-plugin')).toBe(false);
      expect(manager.hasExecutor('reusable_tool')).toBe(false);

      // Re-register with updated executor
      const updatedPlugin: HustlePlugin = {
        ...plugin,
        executors: {
          reusable_tool: async () => 'second',
        },
      };

      await manager.register(updatedPlugin);
      expect(manager.hasPlugin('reusable-plugin')).toBe(true);

      const result = await manager.executeClientTool({
        toolCallId: 'call-reuse',
        toolName: 'reusable_tool',
        args: {},
      });
      expect(result).toBe('second');
    });

    test('should check if executor exists', async () => {
      const plugin: HustlePlugin = {
        name: 'has-executor-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'has_executor',
            description: 'Has executor',
            parameters: { type: 'object', properties: {} },
          },
        ],
        executors: {
          has_executor: async () => true,
        },
      };

      await manager.register(plugin);

      expect(manager.hasExecutor('has_executor')).toBe(true);
      expect(manager.hasExecutor('no_executor')).toBe(false);
    });
  });

  describe('lifecycle hooks', () => {
    test('should run beforeRequest hooks', async () => {
      const beforeRequest = vi.fn((req: HustleRequest) => ({
        ...req,
        modified: true,
      }));

      const plugin: HustlePlugin = {
        name: 'before-request-plugin',
        version: '1.0.0',
        hooks: { beforeRequest },
      };

      await manager.register(plugin);

      const request: HustleRequest = {
        id: 'test-id',
        messages: [],
        vaultId: 'test',
      };
      const modified = (await manager.runBeforeRequest(request)) as TestHustleRequest;

      expect(beforeRequest).toHaveBeenCalledWith(request);
      expect(modified.modified).toBe(true);
    });

    test('should run multiple beforeRequest hooks in order', async () => {
      const calls: number[] = [];

      const plugin1: HustlePlugin = {
        name: 'plugin1',
        version: '1.0.0',
        hooks: {
          beforeRequest: async (req: HustleRequest) => {
            calls.push(1);
            return { ...req, plugin1: true };
          },
        },
      };

      const plugin2: HustlePlugin = {
        name: 'plugin2',
        version: '1.0.0',
        hooks: {
          beforeRequest: async (req: HustleRequest) => {
            calls.push(2);
            return { ...req, plugin2: true };
          },
        },
      };

      await manager.register(plugin1);
      await manager.register(plugin2);

      const request: HustleRequest = {
        id: 'test-id',
        messages: [],
        vaultId: 'test',
      };
      const modified = (await manager.runBeforeRequest(request)) as TestHustleRequest;

      expect(calls).toEqual([1, 2]);
      expect(modified.plugin1).toBe(true);
      expect(modified.plugin2).toBe(true);
    });

    test('should run afterResponse hooks', async () => {
      const afterResponse = vi.fn();

      const plugin: HustlePlugin = {
        name: 'after-response-plugin',
        version: '1.0.0',
        hooks: { afterResponse },
      };

      await manager.register(plugin);

      const response: ProcessedResponse = {
        content: 'test',
        messageId: null,
        usage: null,
        pathInfo: null,
        toolCalls: [],
        toolResults: [],
        reasoning: null,
        intentContext: null,
        devToolsInfo: null,
      };
      await manager.runAfterResponse(response);

      expect(afterResponse).toHaveBeenCalledWith(response);
    });
  });

  describe('getPluginNames', () => {
    test('should return all plugin names', async () => {
      await manager.register({ name: 'plugin-a', version: '1.0.0' });
      await manager.register({ name: 'plugin-b', version: '1.0.0' });
      await manager.register({ name: 'plugin-c', version: '1.0.0' });

      const names = manager.getPluginNames();
      expect(names).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
    });
  });

  describe('debug mode', () => {
    test('should log when debug is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const debugManager = new PluginManager({ debug: true });
      await debugManager.register({
        name: 'debug-plugin',
        version: '1.0.0',
        tools: [
          {
            name: 'debug_tool',
            description: 'Debug tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
