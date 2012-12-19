var redis = require('redis');

var ZKEY = 'completer'; // suffix of key used to store sorted set
var RANGELEN = 50; // suggested by antirez

function Completer(options)
{
	this.options = options || {};
	var port, host;

	if (this.options.client)
		this.redis = options.client;
	else
	{
		port = this.options.port ? parseInt(this.options.port, 10) : 6379;
		host = this.options.host || 'localhost';
		this.redis = redis.createClient(port, host);
	}

	if (this.options.db)
		this.redis.select(this.options.db);

	if (this.options.keyprefix)
		this.zkey = this.options.keyprefix + ZKEY;
	else
		this.zkey = ZKEY;
}
exports.Completer = Completer;

Completer.prototype.client = function()
{
	return this.redis;
};

Completer.prototype.rediskey = function()
{
	return this.zkey;
};

// callback(err, exactCompletionAdded)
Completer.prototype.add = function(input, callback)
{
	var self = this;

	if (Array.isArray(input))
		return this.addList(input, callback);

	if (typeof input !== 'string')
		return callback(new Error('input not string'));

	var word = input.trim().toLowerCase();
	if (word.length === 0)
		return callback(new Error('no empty strings'));

	self.redis.zadd(self.zkey, 0, word+'*', function(err, numadded)
	{
		if (err) return callback(err);
		if (numadded === 0) return callback(null, null); // word already in list

		var pending = 0;
		for (var i=0; i < word.length; i++)
		{
			var prefix = word.slice(0, i);
			pending++;
			self.redis.zadd(self.zkey, 0, prefix, function(err, numadded)
			{
				--pending || callback(err, word);
			});
		}
	});
};

// callback(err, newWordsArray)
Completer.prototype.addList = function(input, callback)
{
	var self = this;
	var results = [];
	var pending = -1;
	for (var i = 0; i < input.length; i++)
	{
		pending++;
		self.add(input[i], function(err, word)
		{
			if (!err && word)
				results.push(word);
			pending-- || callback(err, results);
		});
	}
};

// callback(err, boolRemoved)
Completer.prototype.remove = function(input, callback)
{
	var self = this;
	var removed = false;

	if (typeof input !== 'string')
		return callback(new Error('remove() input not a string'));

	var word = input.trim().toLowerCase();
	if (word.length === 0)
		return callback(null, false);

	self.redis.zrank(self.zkey, word, function(err, rank)
	{
		var pending = 0;
		if (rank === null)
		{
			// No matches for us exactly means that we are *not* a prefix
			// for another completion. Therefore we have to climb the tree
			// removing all prefixes for ourself until we hit another leaf.
			pending++;
			self.redis.zrank(self.zkey, word+'*', function(err, start)
			{
				var right = start; // moves left by rangelen with each pass
				var left = start;
				var done = false;

				var continuer = function(err, range)
				{
					for (var i = range.length - 1; i >= 0; i--)
					{
						var item = range[i];
						if ((item[item.length - 1] === '*') || (item.length >= word.length))
						{
							left = left - range.length + i + 1;
							pending++;
							self.redis.zremrangebyrank(self.zkey, left, start - 1, function(err, count)
							{
								pending-- || callback(err, removed);
							});
							done = true;
							break;
						}
					}

					if (!done)
					{
						right -= RANGELEN;
						left -= RANGELEN;
						pending++;
						self.redis.zrange(self.zkey, right - RANGELEN + 1, right - 1, continuer);
					}

					pending-- || callback(err, removed);
				};

				// Yes, we're going backwards but not using zrevrange.
				self.redis.zrange(self.zkey, right - RANGELEN + 1, right - 1, continuer);
			});
		}

		self.redis.zrem(self.zkey, word+'*', function(err, count)
		{
			if (count === 1) removed = true;
			pending-- || callback(err, removed);
		});
	});
};

// callback(err, exactprefix, completionsArray)
Completer.prototype.complete = function(input, count, callback)
{
	var self = this;
	var results = [];

	if (typeof input !== 'string')
		return callback(new Error('complete() input not a string'));

	var prefix = input.trim().toLowerCase();
	if (prefix.length === 0)
		return callback(null, []); // don't complete empty strings

	self.redis.zrank(self.zkey, prefix, function(err, start)
	{
		if (err || start === null)
		{
			// No hits. The prefix might be an exact match for a leaf, however.
			self.redis.zrank(self.zkey, prefix+'*', function(err, position)
			{
				if (position !== null)
					results.push(prefix);
				return callback(err, prefix, results);
			});
			return;
		}

		var continuer = function(err, range)
		{
			if (err || !range || range.length === 0)
				return callback(err, prefix, results);

			for (var i = 0; i < range.length; i++)
			{
				var item = range[i];

				// Have we moved past the range of relevant results?
				if ((item.length < prefix.length) || (item.slice(0, prefix.length) !== prefix))
					return callback(null, prefix, results);

				// We found a leaf node.
				if (item[item.length - 1] === '*')
				{
					results.push(item.slice(0, -1)); // trim the *
					if (results.length >= count)
						return callback(null, prefix, results);
				}
			}

			start += RANGELEN;
			self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
		};

		self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
	});
};

// callback(err, numdeleted)
Completer.prototype.flush = function(callback)
{
	this.redis.del(this.zkey, callback);
};

// Calculate space usage info, to satisfy my curiosity about overhead.
// callback(err, results)
// where results is a hash.
Completer.prototype.statistics = function(callback)
{
	var self = this;
	self.redis.zcard(self.zkey, function(err, count)
	{
		var start = 0;
		var results =
		{
			leaves: 0,
			leaflen: 0,
			prefixlen: 0,
			total: count
		};

		var continuer = function(err, range)
		{
			if (err || !range || range.length === 0)
				return callback(err, results);

			for (var i = 0; i < range.length; i++)
			{
				var item = range[i];
				if (item[item.length - 1] === '*')
				{
					results.leaves += 1;
					results.leaflen += (item.length - 1);
				}
				else
					results.prefixlen += item.length;
			}

			start += RANGELEN;
			self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
		};

		self.redis.zrange(self.zkey, start, start + RANGELEN - 1, continuer);
	});
};

exports.create = function(options)
{
	return new Completer(options);
};
