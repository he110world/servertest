function Util () {
}

Util.prototype.updateLevel = function (newExp, lv, lvLimit, expTable) {
	while (lv<=lvLimit) {
		lvUpExp = expTable[lv + 1];
		if (newExp >= lvUpExp) {
			if (lv == lvLimit) {
				newExp = lvUpExp;
				break;
			} else {
				++lv;
				newExp -= lvUpExp;
			}
		} else {
			break;
		}
	}

	return [lv, newExp];
}

Util.prototype.randomIntBetween = function (min, max) {
	  return Math.floor(Math.random() * (max - min)) + min;
}

Util.prototype.randomString = function (bits){
	var chars,rand,i,ret;
	chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	ret='';
	// in v8, Math.random() yields 32 pseudo-random bits (in spidermonkey it gives 53)
	while(bits > 0){
		rand=Math.floor(Math.random()*0x100000000); // 32-bit integer
		// base 64 means 6 bits per character, so we use the top 30 bits from rand to give 30/6=5 characters.
		for(i=26; i>0 && bits>0; i-=6, bits-=6) {
			ret+=chars[0x3D & rand >>> i];
		}
	}
	return ret;
}

module.exports = new Util;
