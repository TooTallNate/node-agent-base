import net from 'net';
import http from 'http';
import { EventEmitter } from 'events';
import promisify from './promisify';

function isAgentBase(v: any): v is createAgent.Agent {
	return Boolean(v) && typeof v.addRequest === 'function';
}

function isHttpAgent(v: any): v is http.Agent {
	return Boolean(v) && typeof v.addRequest === 'function';
}

function isSecureEndpoint(): boolean {
	const { stack } = new Error();
	if (typeof stack !== 'string') return false;
	return stack.split('\n').some(l => l.indexOf('(https.js:') !== -1);
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

namespace createAgent {
	export type ClientRequest = http.ClientRequest & {
		_last?: boolean;
		_hadError?: boolean;
		method: string;
	};

	export type AgentCallbackReturn =
		| net.Socket
		| createAgent.Agent
		| http.Agent;

	export type AgentCallbackCallback = (
		err: Error | null | undefined,
		socket: createAgent.AgentCallbackReturn
	) => void;

	export type AgentCallbackPromise = (
		req: createAgent.ClientRequest,
		opts: createAgent.RequestOptions
	) =>
		| createAgent.AgentCallbackReturn
		| Promise<createAgent.AgentCallbackReturn>;

	export type AgentCallback = typeof Agent.prototype.callback;

	export type AgentOptions = http.AgentOptions & {};

	export type RequestOptions = http.RequestOptions & {
		// `port` on http.RequestOptions can be a string or undefined,
		// but `net.TcpNetConnectOpts` expects only a number
		port: number;
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
		public timeout: number | null;
		public options?: createAgent.AgentOptions;
		public maxFreeSockets: number;
		public maxSockets: number;
		public sockets: net.Socket[];
		public requests: http.ClientRequest[];
		private promisifiedCallback?: createAgent.AgentCallbackPromise;
		private explicitDefaultPort?: number;
		private explicitProtocol?: string;

		constructor(
			callback?: createAgent.AgentCallback | createAgent.AgentOptions,
			_opts?: createAgent.AgentOptions
		) {
			super();

			// The callback gets promisified lazily
			this.promisifiedCallback = undefined;

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

			this.options = opts || {};

			this.maxFreeSockets = 1;
			this.maxSockets = 1;
			this.sockets = [];
			this.requests = [];
		}

		get defaultPort(): number {
			if (typeof this.explicitDefaultPort === 'number') {
				return this.explicitDefaultPort;
			}
			return isSecureEndpoint() ? 443 : 80;
		}

		set defaultPort(v: number) {
			this.explicitDefaultPort = v;
		}

		get protocol(): string {
			if (typeof this.explicitProtocol === 'string') {
				return this.explicitProtocol;
			}
			return isSecureEndpoint() ? 'https:' : 'http:';
		}

		set protocol(v: string) {
			this.explicitProtocol = v;
		}

		callback(
			req: createAgent.ClientRequest,
			opts: createAgent.RequestOptions,
			fn: createAgent.AgentCallbackCallback
		): void;
		callback(
			req: createAgent.ClientRequest,
			opts: createAgent.RequestOptions
		):
			| createAgent.AgentCallbackReturn
			| Promise<createAgent.AgentCallbackReturn>;
		callback(
			req: createAgent.ClientRequest,
			opts: createAgent.AgentOptions,
			fn?: createAgent.AgentCallbackCallback
		):
			| createAgent.AgentCallbackReturn
			| Promise<createAgent.AgentCallbackReturn>
			| void {
			throw new Error(
				'"agent-base" has no default implementation, you must subclass and override `callback()`'
			);
		}

		/**
		 * Called by node-core's "_http_client.js" module when creating
		 * a new HTTP request with this Agent instance.
		 *
		 * @api public
		 */
		addRequest(req: ClientRequest, _opts: RequestOptions) {
			const ownOpts: RequestOptions = { ..._opts };

			if (typeof ownOpts.secureEndpoint !== 'boolean') {
				ownOpts.secureEndpoint = isSecureEndpoint();
			}

			// Set default `host` for HTTP to localhost
			if (ownOpts.host == null) {
				ownOpts.host = 'localhost';
			}

			// Set default `port` for HTTP if none was explicitly specified
			if (ownOpts.port == null) {
				ownOpts.port = ownOpts.secureEndpoint ? 443 : 80;
			}

			const opts = { ...this.options, ...ownOpts };

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
			let timedOut = false;
			let timeoutId: ReturnType<typeof setTimeout> | null = null;
			const timeoutMs = opts.timeout || this.timeout;
			const freeSocket = this.freeSocket;

			const onerror = (err: NodeJS.ErrnoException) => {
				if (req._hadError) return;
				req.emit('error', err);
				// For Safety. Some additional errors might fire later on
				// and we need to make sure we don't double-fire the error event.
				req._hadError = true;
			};

			const ontimeout = () => {
				timeoutId = null;
				timedOut = true;
				const err: NodeJS.ErrnoException = new Error(
					`A "socket" was not created for HTTP request before ${timeoutMs}ms`
				);
				err.code = 'ETIMEOUT';
				onerror(err);
			};

			const callbackError = (err: NodeJS.ErrnoException) => {
				if (timedOut) return;
				if (timeoutId !== null) {
					clearTimeout(timeoutId);
					timeoutId = null;
				}
				onerror(err);
			};

			const onsocket = (socket: AgentCallbackReturn) => {
				let sock: net.Socket;

				const onfree = () => {
					freeSocket.call(this, sock, opts);
				};

				if (timedOut) return;
				if (timeoutId != null) {
					clearTimeout(timeoutId);
					timeoutId = null;
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
			};

			if (typeof this.callback !== 'function') {
				onerror(new Error('`callback` is not defined'));
				return;
			}

			if (!this.promisifiedCallback) {
				if (this.callback.length >= 3) {
					// Legacy callback function - convert to a Promise
					this.promisifiedCallback = promisify(this.callback);
				} else {
					this.promisifiedCallback = this.callback;
				}
			}

			if (typeof timeoutMs === 'number' && timeoutMs > 0) {
				timeoutId = setTimeout(ontimeout, timeoutMs);
			}

			if ('port' in opts && typeof opts.port !== 'number') {
				opts.port = Number(opts.port);
			}

			try {
				Promise.resolve(this.promisifiedCallback(req, opts)).then(
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

		destroy() {}
	}

	// So that `instanceof` works correctly
	createAgent.prototype = createAgent.Agent.prototype;
}

export = createAgent;
