var Util = require('./util');

// cannot use something like: table = require('./table.json'), since table.json make be updated.
function Girl(table) {
	if (table) {
		this.table = table;
	}
}

Girl.prototype.newGirl = function (table, id) {
	this.ID = id;
  	this.Lv = 1;
	this.GirlExp = 0;
	this.RankExp = 0;

	var girl = table.girl[id];
	this.Cost = girl.Cost;
	this.Rank = girl.Rank;
}

Girl.prototype.buyGirl = function (table, itemcounts) {
	var odds = [20, 20, 20, 20, 20];
	for (var id in itemcounts) {
		var count = itemcounts[id];
		var effect = table.item[id].Effect;
		if (effect >= 5 && effect <= 9) {
			var effval = table.item[id].EffectValue;
			var incdec = effval.split('$');
			for (var e=0; e<5; e++) {
				if (e == effect-5) {
					odds[e] += incdec[0]*count;
				} else {
					odds[e] -= incdec[1]*count;
				}
			}	
		}
	}

	// which wuxing?
	var rand = Math.floor(Math.random()*100);
	for (var wx=0; wx<5; wx++) {
		rand -= odds[wx];
		if (rand<0) {
			break;
		}
	}
	wx += 1;

	// rare
	// 4: 1.5%
	// 3: 28.5%
	// 2: 70%
	rand = Math.random()*100;
	var rare = 1;
	if (rand < 1.5) {
		rare = 4;
	} else if (rand < 28.5) {
		rare = 3;
	} else {
		rare = 2;
	}

	// find all suitable girls 
	var raregirls = [];
	var matchgirls = [];
	for (var g in table.girl) {
		var r = table.girl[g].Rare;
		if (r == rare) {
			raregirls.push(table.girl[g]);
			if (wx == table.girl[g].Wuxing) {
				matchgirls.push(table.girl[g]);
			}
		}
	}

	if (matchgirls.length > 0) {	// found
		var girl = matchgirls[Math.floor(Math.random()*matchgirls.length)];
	} else {
		var girl = raregirls[Math.floor(Math.random()*raregirls.length)];
	}

	return girl.ID;
}

Girl.prototype.checkVar = function () {
	for (var i=0; i<arguments.length; i++) {
		var arg = arguments[i];
		if (typeof this[arg] == 'undefined') {
			throw new Error(arg);
		}
	}
}

Girl.prototype.addRankExp = function (expInc) {
	this.checkVar('table', 'RankExp', 'Rank');
	var mod = {};
	var Rank = Math.floor(this.Rank);
	var RankLimit = this.table.exp.Rank.length - 1;
	var newExp = Math.floor(this.RankExp) + Math.floor(expInc);
	var ret = Util.updateLevel(newExp, Rank, RankLimit, this.table.exp.RankExp);
	Rank = ret[0];
	newExp = ret[1];
	if (Rank != this.Rank) {
		mod.Rank = Rank;
	}
	mod.RankExp = this.RankExp = newExp;
	return mod;
}

Girl.prototype.addExp = function (expInc) {
	this.checkVar('table', 'GirlExp', 'Lv', 'Rank');
	var mod = {};
	var Lv = Math.floor(this.Lv);
	var Rank = Math.floor(this.Rank);
	var LvLimit = Math.floor(this.table.exp.LvLimit[Rank]);
	var newExp = Math.floor(this.GirlExp) + Math.floor(expInc);
	var ret = Util.updateLevel(newExp, Lv, LvLimit, this.table.exp.GirlExp);
	Lv = ret[0];
	newExp = ret[1];
	if (Lv != this.Lv) {
		mod.Lv = Lv;
	}
	mod.GirlExp = this.GirlExp = newExp;
	this.Lv = Lv;

	return mod;
}

module.exports = Girl;
