function getDistance(groups) {
    var exits = Game.map.findRoute(groups.spawn.room.name, groups.room);
    return exits.length * 2 + 1;
}
 
var recommendations = [{
    count : groups => Math.min(hasSize(groups.harvester) + 1, getWorkerCount(groups)),
    type : miner,
    body : groups => makeBody(groups, [...Array.from({
        length : Math.min(Object.keys(Game.spawns).length + 1, getDistance(groups))
    }).map(_ => MOVE), WORK], [WORK], hasHalf(groups))
}, {
    count : groups => {
        return Math.min(hasSize(groups.miner) * getDistance(groups) + 1, getWorkerCount(groups) * getDistance(groups));
    },
    type : harvester,
    body : groups => makeBody(groups, [CARRY, MOVE], [CARRY, MOVE], hasHalf(groups))
}, { 
    count : groups => redAlert ? 1 : 0,
    type : quickfighter, //quick fighter for emergencies
    body : groups => [TOUGH, TOUGH, MOVE, MOVE, MOVE, ATTACK]
}, {
    count : groups => getWorkerCount(groups),
    type : upgrader,
    body : workerBody
}, {
    count : groups => getWorkerCount(groups),
    type : builder,
    body : workerBody
}, {
    count : groups => {
        var capacity = groups.spawn.room.energyCapacityAvailable;
        var cost = BODYPART_COST.claim + BODYPART_COST.move;
        return (cost <= capacity && groups.room.controller && !groups.room.controller.my && Game.gcl.level > roomsControlled()) ? 1 : 0;
    },
    type : claimer,
    body : () => [MOVE, CLAIM]
}, {
    count : groups => getWorkerCount(groups),
    type : fighter,
    body : fighterBody
}, {
    count : groups => {
        var exits = Game.map.describeExits(groups.room.name);
        return Object.keys(exits).filter(key => !Game.rooms[exits[key]]).length ? 1 : 0;
    },
    type : expander,
    body : () => [MOVE]
}];

for(var i in Game.constructionSites) {
    var cs = Game.constructionSites[i];
    if(!cs.progress) {
        cs.remove();
    }
}

function roomsControlled() {
    return Object.keys(Game.rooms).reduce((total, key) => (Game.rooms[key].controller && Game.rooms[key].controller.my ? 1 : 0) + total, 0);
}

function assignSpawns() {
    var keys = Object.keys(Game.spawns).sort();
    for(var i in Game.rooms) {
        var room = Game.rooms[i];
        var spawn = room.find(FIND_MY_STRUCTURES, {
            filter : structure => structure.structureType === STRUCTURE_SPAWN
        })[0]; 
        var values = (/\w(\d+)\w(\d+)/).exec(room.name);
        var value = +values[1] + +values[2];
        room.memory.spawn = spawn ? spawn.name : keys[value % keys.length];
    }
}

var cache;
function clearCache() {
    cache = {};
}

module.exports.loop = function () {
    clearCache();
    redAlertRoom = Game.rooms[redAlertRoom] ? redAlertRoom : false;
    for(var name in Memory.creeps) {
        if(!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }
    assignSpawns();
    var creeps = Object.keys(Game.creeps).reduce((creeps, key) => {
        var creep = Game.creeps[key];
        creeps.push(creep);
        if(!Game.rooms[creep.memory.home]) {
            goHome(creep);
        }
        return creeps;
    }, []);
    var now = new Date().getTime();
    var toSpawn = [];
    
    var rooms = creeps.reduce((rooms, creep) => {
        var groups = rooms[creep.memory.home] = rooms[creep.memory.home] || {};
        var group = groups[creep.memory.type] = groups[creep.memory.type] || [];
        group.push(creep);
        return rooms;
    }, {});
    
    for(var i in Game.rooms) {
        var r = Game.rooms[i];
        room(r, rooms[i] || {}, now, toSpawn);
        addSites(r);
        var hostiles = getHostiles(r);
        var my = r.find(FIND_MY_CREEPS).filter(creep => creep.hits < creep.hitsMax);
        r.find(FIND_MY_STRUCTURES, {
            filter : structure => structure.structureType === STRUCTURE_TOWER
        }).forEach(tower => {
            if(hostiles.length) {
                tower.attack(hostiles[0]);
            } else {
                tower.heal(my[0]);
            }
        });
    }
    toSpawn.sort((a, b) => a.level - b.level);
    for(var i in Game.spawns) {
        var spawn = Game.spawns[i];
        var level = (toSpawn[0] || {level:0}).level;
        for(var i = 0; i < toSpawn.length && toSpawn[i].level <= level; i++) {
            var data = toSpawn[i];
            if(spawn.createCreep(data.body, undefined, data.memory) === OK) {
                toSpawn.splice(i, 1);
                break;
            } 
        }
    }
    if(redAlertRoom) {
        console.log("RED ALERT IN ", redAlertRoom);
    }
    console.log(creeps.length);
    console.log("--------");
};

//HELPERS

function hasHalf(groups) {
    var workers = Math.floor(getWorkerCount(groups) / 2);
    return hasSize(groups.miner) >= workers && hasSize(groups.harvester) >= workers;
}

function makeBody(groups, front, sequence, doit) {
    var cost = front.reduce((cost, part) => cost + BODYPART_COST[part], 0);
    var max = cost + sequence.reduce((cost, part) => cost + BODYPART_COST[part], 0) * Object.keys(Game.spawns).length;
    var i = 0;
    while(doit && (cost += BODYPART_COST[sequence[i % sequence.length]]) <= groups.spawn.room.energyCapacityAvailable && cost <= max && front.length < MAX_CREEP_SIZE) {
        front.push(sequence[i % sequence.length]);
        i++;
    }
    for(var i = 0; i < front.length / 2; i++) {
        var temp = front[i];
        front[i] = front[front.length - i - 1];
        front[front.length - i - 1] = temp;
    }
    return front;
}

function getWorkerCount(groups) {
    return groups.room.find(FIND_SOURCES).length;
}

function getMiners(groups, source) {
    var x = source.pos.x, y = source.pos.y;
    return groups.room.lookForAtArea(LOOK_CREEPS, y - 1, x - 1, y + 1, x + 1, true).filter(creep => creep.creep.memory.type === "miner", true).length;
}

function fighterBody(groups) {
    return makeBody(groups, [ATTACK, RANGED_ATTACK, MOVE, TOUGH, TOUGH], [ATTACK, RANGED_ATTACK, MOVE, TOUGH, TOUGH], true);
}

function workerBody(groups) {
    return makeBody(groups, [MOVE, CARRY, WORK], [MOVE, CARRY, WORK], true);
}

function hasSize(r) {
    return r ? r.length : 0;
}

function createPath(creep) {
    var x = creep.pos.x, y = creep.pos.y;
    var terrain = creep.room.lookForAt(LOOK_TERRAIN, x, y)[0];
    if(terrain === "swamp") {
        creep.room.createConstructionSite(x, y, STRUCTURE_ROAD);
    }
}

var mycs = {};

function moveTo(creep) {
    var args = Array.prototype.slice.call(arguments, 1);
    var path = creep.pos.findPathTo.apply(creep.pos, args);
    creep.moveByPath(path);
}

function getDropped(creep) {
    if(!goHome(creep)) {
        var droppedEnergy = getDroppedList(creep.room);
        var t = target(creep, droppedEnergy);
        if(creep.pickup(t) == ERR_NOT_IN_RANGE) {
            moveTo(creep, t, {
                maxRooms : 1
            });  
        }
    }
}

function fight(creep) {
    var hostiles = getHostiles(creep.room);
    var hostile = target(creep, hostiles)
    if(hostile) {
        if(creep.attack(hostile) === ERR_NOT_IN_RANGE || creep.rangedAttack(hostile) === ERR_NOT_IN_RANGE) {
           moveTo(creep, hostile, {
               maxRooms : 1
           }); 
        }
        return true;
    }
    return false;
}

function squareFrom(x, y, callback) {
    var range = 1;
    while(true) {
        var range2 = 2 * range;
        for(var i = 0; i < range2; i++) { //top left to right
            if(callback(x - range + i, y - range) || callback(x - range, y - range + i) || callback(x + range, y - range + i) || callback(x - range + i, y + range)) {
                return;
            }
        }
        range++;
    }
}

function switchStates(creep) {
    if(creep.memory.state && creep.carry.energy == 0) {
        creep.memory.state = false;
        creep.say('harvesting');
    } else if(!creep.memory.state && creep.carry.energy == creep.carryCapacity) {
        creep.memory.state = true;
        creep.say("working");
    }
    return creep.memory.state;
}

function addSite(room, site) {
    var cs = room.find(FIND_MY_CONSTRUCTION_SITES);
    if(cs.length < MAX_CONSTRUCTION_SITES) {
        var max = CONTROLLER_STRUCTURES[site][room.controller ? room.controller.level : 0];
        var built = room.find(FIND_MY_STRUCTURES, {
            filter : structure => structure.structureType === site 
        }).length;
        var toBuild = room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter : cs => cs.structureType === site
        }).length;
        if(built + toBuild < max) {
            squareFrom(25, 25, (x, y) => {
                var terrain = room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true);
                var hasWall = terrain.reduce((hasWall, terrain) => hasWall || terrain.terrain === "wall", false);
                var goodSpot = (x + y) % 2 === 1 && !hasWall;
                var result = goodSpot ? room.createConstructionSite(x, y, site) : false;
                return x === 0 || result === OK;
            });   
        }
    }
}

function addSites(room) {
    if(room.controller && room.controller.my) {
        addSite(room, STRUCTURE_SPAWN);
        addSite(room, STRUCTURE_TOWER);
        addSite(room, STRUCTURE_EXTENSION);
        addSite(room, STRUCTURE_STORAGE);
    }
}

function goToRoom(creep, room) {
    var exits = Game.map.findRoute(creep.room.name, room);
    if(exits.length) {
        var exit = creep.pos.findClosestByPath(exits[0].exit);
        if(exit) {
            moveTo(creep, exit, {
                maxRooms : 1
            }); 
        }  
    }
}

function goHome(creep) {
    if(creep.room.name !== creep.memory.home && creep.memory.home !== redAlertRoom) {
        goToRoom(creep, creep.memory.home);
        return true;
    }
    return false;
}

function target(creep, targets) {
    var target = targets.find(target => target.id === creep.memory.target) || targets[0];
    target && (creep.memory.target = target.id);
    return target;
}

function getDroppedList(room) {
    if(!cache[room] || !cache[room]["dropped"]) {
        var c = cache[room] = cache[room] || {};
        c["dropped"] = room.find(FIND_DROPPED_ENERGY).sort((a, b) => b.amount - a.amount);
    }
    return cache[room]["dropped"];
}

function getStorage(room) {
    return room.find(FIND_MY_STRUCTURES, {
        filter: structure => (structure.energy < structure.energyCapacity) || (structure.store && (structure.store[RESOURCE_ENERGY] < structure.storeCapacity))
    }).sort((a, b) => (a.energyCapacity || a.storeCapacity) - (b.energyCapacity || b.storeCapacity)).reduce((sources, source) => {
        if(source.structureType === STRUCTURE_TOWER) { 
            sources.unshift(source);
        } else {
            sources.push(source);
        }
        return sources;
    }, []);
}

function getHostiles(room) {
    if(!cache[room] || !cache[room]["hostiles"]) {
        var c = cache[room] = cache[room] || {};
        c["hostiles"] = [...room.find(FIND_HOSTILE_STRUCTURES), ...room.find(FIND_HOSTILE_CREEPS)]; 
    }
    return cache[room]["hostiles"];
}

function getDamaged(room) {
    return room.find(FIND_MY_STRUCTURES, {
        filter : structure => structure.hits < structure.hitsMax
    }).sort((a, b) => (b.hitsMax - b.hits) - (a.hitsMax - a.hits));
}

function getSites(room) {
    return room.find(FIND_MY_CONSTRUCTION_SITES).sort((a, b) => (b.progressTotal + b.progress) - (a.progressTotal + a.progress));
}

//ROLES

function room(room, groups, now, toSpawn) {
    var spawn = Game.spawns[room.memory.spawn];
    console.log(Object.keys(groups).sort().map(key => [key, groups[key].length]));
    groups.now = now;
    groups.spawn = spawn; 
    groups.room = room;
    redAlert(room);
    recommendations.forEach((recommendation, level) => {
        var type = recommendation.type.name, count = groups[type] ? groups[type].length : 0;
        if(count < recommendation.count(groups)) {
            toSpawn.push({
                body : recommendation.body(groups),
                level,
                memory : {
                    type : type,
                    home : room.name
                }
            });
        }
        if(groups[type]) {
            groups[type].forEach(creep => {
                recommendation.type(creep, groups)
                createPath(creep);
            });
        }
    });
}

function harvester(creep, groups) {
    if(switchStates(creep)) {
        var targets = getStorage(groups.spawn.room);
        var t = target(creep, targets);
        if(t) {
            if(creep.transfer(t, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                moveTo(creep, t, {});
            }
        }
    } else {
        getDropped(creep);
    }
}
        
function builder(creep, groups) {
    if(switchStates(creep)) {
        var targets = getDamaged(creep.room);
        var t = target(creep, targets)
        if(t) {
            if(creep.repair(t) == ERR_NOT_IN_RANGE) {
                moveTo(creep, t, {
                    maxRooms : 1
                });
            }
        } else {
            var targets = getSites(creep.room);
            var t = target(creep, targets);
            if(t) { 
                var cs = Game.constructionSites[t.id];
                if(creep.build(cs) == ERR_NOT_IN_RANGE) {
                    moveTo(creep, cs, {
                        maxRooms : 1
                    });
                }
            } else {
                upgrader(creep, groups);
            }
        }
    } else {
        getStored(creep);
    }
}

function upgrader(creep, groups) {
    if(switchStates(creep)) {
        var controller = groups.spawn.room.controller;
        if(creep.upgradeController(controller) == ERR_NOT_IN_RANGE) {
            moveTo(creep, controller, {});
        }
    } else {
        getStored(creep);
    }
}

function getStored(creep) {
    var sources = creep.room.find(FIND_MY_STRUCTURES, {
        filter: structure => structure.store && structure.store[RESOURCE_ENERGY]
    });
    if(sources.length) {
        var t = target(creep, sources);
        if(creep.withdraw(t, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(t);
        }
    } else {
        getDropped(creep);
    }
}

var five_minutes = 1000 * 60 * 5;

function fighter(creep, groups) {
    if(redAlertRoom) {
        if(!fight(creep)) {
            goToRoom(creep, redAlertRoom);
        }
    } else if(!fight(creep) && !goHome(creep)) {
        switch(Math.floor(groups.now / five_minutes) % 4) {
            case 0 :
                moveTo(creep, 10, 10, {
                    maxRooms : 1
                });
                break;
            case 1 :
                moveTo(creep, 40, 10, {
                    maxRooms : 1
                });
                break;
            case 2 :
                moveTo(creep, 40, 40, {
                    maxRooms : 1
                });
                break;
            case 3 :
                moveTo(creep, 10, 40, {
                    maxRooms : 1
                });
                break;
        }
    }
}

var redAlertRoom = "";

function redAlert(room) {
    var hostiles = getHostiles(room);
    if(hostiles.length) {
        redAlertRoom = room.name;
    } else if(room.name === redAlertRoom) {
        redAlertRoom = false;
    }
}

function miner(creep, groups) {
    if(!goHome(creep)) {
        var t = creep.pos.findClosestByPath(FIND_SOURCES);
        if(creep.harvest(t) === ERR_NOT_IN_RANGE) {
            var sources = creep.room.find(FIND_SOURCES, {
                filter : source => !getMiners(groups, source)
            });
            t = target(creep, sources) || t;
            moveTo(creep, t, {
                maxRooms : 1
            });
        }
    }
}

function expander(creep, groups) {
    if(!creep.memory.goal) {
        var home = Game.rooms[creep.memory.home];
        if(home) {
            var exits = Game.map.describeExits(home.name);
            var rooms = Object.keys(exits).map(key => exits[key]).filter(name => !Game.rooms[name]);
            creep.memory.goal = rooms[0];
        }
    } else {
        if(creep.room.name !== creep.memory.goal) {
            goToRoom(creep, creep.memory.goal);
        } else {
            moveTo(creep, 25, 25, {
                maxRooms : 1
            });
            creep.say("mine");
        }
    }
}
    
    
function claimer(creep) {
    if(!goHome(creep)) {
        if(creep.claimController(creep.room.controller) === ERR_NOT_IN_RANGE) {
            creep.moveTo(creep.room.controller);
        }
    }
}    

function quickfighter(creep, groups) {
    fighter(creep, groups);
}