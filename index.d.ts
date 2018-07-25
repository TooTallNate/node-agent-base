// Type definitions for agent-base 4.2.1
// Project: https://github.com/TooTallNate/node-agent-base
// Definitions by: Christopher Quadflieg <https://github.com/Shinigami92>

/// <reference types="node" />
import { EventEmitter } from 'events';
import './patch-core';

declare type AgentCallback = (
	req?: any,
	opts?: {
		secureEndpoint: boolean;
	}
) => void;

interface AgentOptions {
	timeout?: number;
	host?: string;
	port?: number;
	[key: string]: any;
}

interface IAgent extends EventEmitter {
	_promisifiedCallback: boolean;
	timeout: number | null;
	options?: AgentOptions;
	callback: AgentCallback;
	addRequest: (req?: any, opts?: any) => void;
	freeSocket: (socket: any, opts: any) => void;
}

/**
 * Base `http.Agent` implementation.
 * No pooling/keep-alive is implemented by default.
 */
declare function Agent(opts?: AgentOptions): IAgent;
declare function Agent(callback: AgentCallback, opts?: AgentOptions): IAgent;

export = Agent;
