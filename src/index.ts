import './patch-core';
import net from 'net';
import http from 'http';
import promisify from 'es6-promisify';
import { EventEmitter } from 'events';

function isAgentBase(v: any): v is createAgent.Agent {
	return Boolean(v) && typeof v.addRequest === 'function';
}

function isHttpAgent(v: any): v is http.Agent {
	return Boolean(v) && typeof v.addRequest === 'function';
}

function createAgent(opts?: createAgent.AgentOptions): createAgent.Agent;
function createAgent(
	callback: createAgent.AgentCallback,
	opts?: createAgent.AgentOptions
): createAgent.Agent;
function createAgent(
	callback?: createAgent.AgentCallback | createAgent.AgentOptions,
	opts?: createAgent.AgentOptions
) {
	return new createAgent.Agent(callback, opts);
}

async function defaultCallback(
	req: createAgent.ClientRequest,
	opts: createAgent.AgentOptions
): Promise<createAgent.Agent> {
	throw new Error(
		'"agent-base" has no default implementation, you must subclass and override `callback()`'
	);
}

namespace createAgent {
	export type ClientRequest = http.ClientRequest & {
		_last?: boolean;
		_hadError?: boolean;
		method: string;
	};

	export type AgentCallback = (
		req: ClientRequest,
		opts: RequestOptions
	) => Promise<net.Socket | createAgent.Agent | http.Agent>;

	export type AgentOptions = http.AgentOptions & {};

	export type RequestOptions = http.RequestOptions & {
		secureEndpoint: boolean;
	};

	/**
	 * Base `http.Agent` implementation.
	 * No pooling/keep-alive is implemented by default.
	 *
	 * @param {Function} callback
	 * @api public
	 */
	export class Agent extends EventEmitter {
		private _promisifiedCallback: boolean;
		public timeout: number | null;
		public options?: createAgent.AgentOptions;
		public callback?: createAgent.AgentCallback;

		constructor(
			callback?: createAgent.AgentCallback | createAgent.AgentOptions,
			_opts?: createAgent.AgentOptions
		) {
			super();

			// The callback gets promisified if it has 3 parameters
			// (i.e. it has a callback function) lazily
			this._promisifiedCallback = false;

			let opts = _opts;
			if (typeof callback === 'function') {
				this.callback = callback;
			} else if (callback) {
				opts = callback;
			}

			// timeout for the socket to be returned from the callback
			this.timeout = null;
			if (opts && typeof opts.timeout === 'number') {
				this.timeout = opts.timeout;
			}

			if (typeof this.callback !== 'function') {
				this.callback = defaultCallback;
			}

			this.options = opts || {};
		}

		/**
		 * Called by node-core's "_http_client.js" module when creating
		 * a new HTTP request with this Agent instance.
		 *
		 * @api public
		 */
		addRequest(req: ClientRequest, _opts: RequestOptions) {
			const ownOpts: RequestOptions = Object.assign({}, _opts);

			// Set default `host` for HTTP to localhost
			if (ownOpts.host == null) {
				ownOpts.host = 'localhost';
			}

			// Set default `port` for HTTP if none was explicitly specified
			if (ownOpts.port == null) {
				ownOpts.port = ownOpts.secureEndpoint ? 443 : 80;
			}

			const opts = Object.assign({}, this.options, ownOpts);

			if (opts.host && opts.path) {
				// If both a `host` and `path` are specified then it's most likely the
				// result of a `url.parse()` call... we need to remove the `path` portion so
				// that `net.connect()` doesn't attempt to open that as a unix socket file.
				delete opts.path;
			}

			delete opts.agent;
			delete opts.hostname;
			delete opts._defaultAgent;
			delete opts.defaultPort;
			delete opts.createConnection;

			// Hint to use "Connection: close"
			// XXX: non-documented `http` module API :(
			req._last = true;
			req.shouldKeepAlive = false;

			// Create the `stream.Duplex` instance
			let timeout: ReturnType<typeof setTimeout> | null = null;
			let timedOut = false;
			const timeoutMs = this.timeout;
			const freeSocket = this.freeSocket;

			function onerror(err: NodeJS.ErrnoException) {
				if (req._hadError) return;
				req.emit('error', err);
				// For Safety. Some additional errors might fire later on
				// and we need to make sure we don't double-fire the error event.
				req._hadError = true;
			}

			function ontimeout() {
				timeout = null;
				timedOut = true;
				const err: NodeJS.ErrnoException = new Error(
					`A "socket" was not created for HTTP request before ${timeoutMs}ms`
				);
				err.code = 'ETIMEOUT';
				onerror(err);
			}

			function callbackError(err: NodeJS.ErrnoException) {
				if (timedOut) return;
				if (timeout != null) {
					clearTimeout(timeout);
					timeout = null;
				}
				onerror(err);
			}

			function onsocket(socket: net.Socket | createAgent.Agent | http.Agent) {
				let sock: net.Socket;

				function onfree() {
					freeSocket(sock, opts);
				}

				if (timedOut) return;
				if (timeout != null) {
					clearTimeout(timeout);
					timeout = null;
				}

				if (isAgentBase(socket) || isHttpAgent(socket)) {
					// `socket` is actually an `http.Agent` instance, so
					// relinquish responsibility for this `req` to the Agent
					// from here on
					(socket as createAgent.Agent).addRequest(req, opts);
					return;
				}

				if (socket) {
					sock = socket;
					sock.on('free', onfree);
					req.onSocket(sock);
					return;
				}

				const err = new Error(
					`no Duplex stream was returned to agent-base for \`${req.method} ${req.path}\``
				);
				onerror(err);
			}

			if (typeof this.callback !== 'function') {
				onerror(new Error('`callback` is not defined'));
				return;
			}

			if (!this._promisifiedCallback && this.callback.length >= 3) {
				// Legacy callback function - convert to a Promise
				this.callback = promisify(this.callback, { thisArg: this });
				this._promisifiedCallback = true;
			}

			if (typeof timeoutMs === 'number' && timeoutMs > 0) {
				timeout = setTimeout(ontimeout, timeoutMs);
			}

			try {
				Promise.resolve(this.callback(req, opts)).then(
					onsocket,
					callbackError
				);
			} catch (err) {
				Promise.reject(err).catch(callbackError);
			}
		}

		freeSocket(socket: net.Socket, opts: AgentOptions) {
			// TODO reuse sockets
			socket.destroy();
		}
	}
}

// So that `instanceof` works correctly
createAgent.prototype = createAgent.Agent.prototype;

export = createAgent;
