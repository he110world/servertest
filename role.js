function Role(table) {
	if (table) {
		this.table = table;
	}
}

Role.prototype.newRole = function () {
  	this.Lv = 1;
	this.RoleExp = 0;
	this.Credit = 0;
	this.PhotonSeed = 0;
	this.FriendCoin = 0;
	this.OddCoin = 0;
	this.Cost = 50;
}

Role.prototype.checkVar = function () {
	for (var i=0; i<arguments.length; i++) {
		var arg = arguments[i];
		if (typeof this[arg] == 'undefined') {
			throw new Error(arg);
		}
	}
}

Role.prototype.addExp = function (expInc) {
	this.checkVar('table', 'RoleExp', 'Lv');
	var mod = {};
	var Lv = Math.floor(this.Lv);
	var newExp = Math.floor(this.RoleExp) + Math.floor(expInc);
	while (Lv<=999) {
		var lvUpExp = Math.floor(this.table.exp.RoleExp[Lv+1]);
		if (newExp >= lvUpExp) {
			if (Lv == 999) {
				newExp = lvUpExp;
				break;
			} else {
				++Lv;
				newExp -= lvUpExp;
			}
		} else {
			break;
		}
	}
	if (Lv != this.Lv) {
		mod.Lv = Lv;
	}
	mod.RoleExp = this.RoleExp = newExp;
	this.Lv = Lv;

	return mod;
}

module.exports = Role;
