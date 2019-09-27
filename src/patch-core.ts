import url from 'url';
import https from 'https';

const patchMarker = '__agent_base_https_request_patched__';

/**
 * This currently needs to be applied to all Node.js versions
 * in order to determine if the `req` is an HTTP or HTTPS request.
 *
 * There is currently no PR attempting to move this property upstream.
 */
if (!(https.request as any)[patchMarker]) {
	https.request = (function(request) {
		// @ts-ignore
		return function(_options, cb) {
			let options;
			if (typeof _options === 'string') {
				options = url.parse(_options);
			} else {
				options = Object.assign({}, _options);
			}
			if (null == options.port) {
				options.port = 443;
			}
			options.secureEndpoint = true;
			return request.call(https, options, cb);
		};
	})(https.request);
	(https.request as any)[patchMarker] = true;

	/**
	 * This is needed for Node.js >= 9.0.0 to make sure `https.get()` uses the
	 * patched `https.request()`.
	 *
	 * Ref: https://github.com/nodejs/node/commit/5118f31
	 */
	// @ts-ignore
	https.get = function(_url, _options, cb) {
		let options;
		if (
			typeof _url === 'string' &&
			_options &&
			typeof _options !== 'function'
		) {
			options = Object.assign({}, url.parse(_url), _options);
		} else if (!_options && !cb) {
			options = _url;
		} else if (!cb) {
			options = _url;
			cb = _options;
		}

		const req = https.request(options, cb);
		req.end();
		return req;
	};
}
