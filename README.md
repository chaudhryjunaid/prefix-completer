## Simple Prefix Completer

[![on npm](http://img.shields.io/npm/v/prefix-completer.svg?style=flat)](https://www.npmjs.org/package/prefix-completer)  [![Tests](http://img.shields.io/travis/ceejbot/prefix-completer.svg?style=flat)](http://travis-ci.org/ceejbot/prefix-completer) ![Coverage](http://img.shields.io/badge/coverage-91%25-green.svg?style=flat) [![Dependencies](http://img.shields.io/david/ceejbot/prefix-completer.svg?style=flat)](https://david-dm.org/ceejbot/prefix-completer)

A simple prefix completion library for [node.js](http://nodejs.org/) & [Redis](http://redis.io/). Stores texts & their prefixes in redis according to the algorithm given by [antirez](https://github.com/antirez) [in this gist](https://gist.github.com/574044). It's inefficient with space but leverages the redis sorted set data structure cleverly.

The use case it was developed for is tag auto-completion, for which I needed no fancy datastructures or scoring approaches. The only scoring used is lexical sorting. No additional data is stored along with the texts. All texts are stored and searched in lower case.

## Usage

`npm install prefix-completer`

Here's an example showing typical use: creating a completer dictionary,
adding words to it, then requesting completions from it.

```javascript
var completer = require('prefix-completer');
var async = require('async');

// make a dictionary
var tags = completer.create( { key: 'tags', db: 31 } );
console.log("zkey: "+tags.rediskey()); // -> 'tags'

// make a second completion dictionary
var usertags = completer.create( { key: 'users', db: 31 });
console.log("zkey: "+usertags.rediskey()); // -> 'users'

var wordlist = ['supernumary', ' superb ', 'Super', 'mary poppins', 'bert the sweep', 'codfish', 'sugar'];

async.series(
[
	function(cb) { tags.flush(cb) }, // clear for the example
	function(cb) { tags.add('supercalifragilisticexpialidocious', cb) }, // add a single word
	function(cb) { tags.addList(wordlist, cb) }, // add a list of words
	function(cb) { tags.complete('supe', 15, cb) }, // get completions for a prefix
	function(cb) { usertags.complete('supe', 15, cb) } // get completions from another dictionary
],
function(err, results)
{
	console.log("added 1 completion to dict: "+results[1]);
	console.log('added '+results[2].length+" completions to dict");
	console.log("found "+results[3][1].length+" completions for '"+results[3][0]+"':");
	console.log(results[3][1]);
	console.log("the user tags dictionary has "+results[4][1].length+" completions for 'supe'");
	process.exit(0);
});
```

## API

### create()

`completer = create([options])`

Create a completion dictionary. Synchronous. Takes optional hash of parameters. Valid parameters:

__host__: string specifying redis host (defaults to localhost)  
__port__: integer specifying redis port (defaults to 6379)  
__db__: integer specifying the redis database to select (defaults to 0)  
__key__: a short string key for the redis sorted set key; change it to namespace lookup dictionaries (defaults to `'COMP'`)
__client__: an existing RedisClient


### add()

`completer.add(completion, function(err, added) {})`

Add a string to the completion dictionary. Leading & trailing space are removed and the string is converted to lowercase. Responds with the exact string added. If the string was already present, responds with null. Can also accept an array of additions in the first parameter.

### addList()

`completer.add(stringlist, function(err, addedlist) {})`

Add an array of strings to the completion dictionary. Responds with an array of the exact strings added. Skips strings that were already present.

### complete()

`completer.complete(prefix, maxresults, function(err, prefixcleaned, completions) {})`

Search for completions for the passed-in search string. Responds with the exact string searched for and an array of completions containing at most `maxresults` strings. The `maxresults` parameter is optional; it defaults to 50 if not passed.

### remove()

`completer.remove(completion, function(err, removed) {})`

Removes the specified completion from the dictionary. Responds with true if successful.

### flush()

`completer.flush(function(err, count) {})`

Delete the key used to store this dictionary set. Passes the callback straight through to the redis DEL call, which responds with the number of keys deleted.

### statistics()

`completer.statistics(function(err, results))`

Get statistics on the current state of the completion database. Responds with a hash containing the following keys:

__total__: total number of entries in the database  
__leaves__: number of completion phrases stored  
__leaflen__: characters used for completion phrases  
__prefixlen__: characters used for prefix storage

### leaves()

`completer.leaves(function(err, leaves))`

Responds with an array containing all leaf nodes in the dictionary, that is, every valid completion. Does not strip the terminating `*` characters.

### dump()

`completer.dump(function(err, items))`

Responds with an array containing all the items stored in the dictionary. Perhaps useful for debugging.

## LICENSE

MIT
