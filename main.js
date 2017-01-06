Memory.miners = Memory.miners || {};

Memory.claimers = Memory.claimers || {};

var sortCS = (a, b) => (b.progress + b.progressTotal) - (a.progress + a.progressTotal);
var sortDropped = (a, b) => b.energy - a.energy;
var sortStores = (a, b) => {
    var structures = [STRUCTURE_TOWER];
    if(structures.includes(a.structureType)) {
        return -1;
    } else if(structures.includes(b.structureType)) {
        return 1;
    }
    return (a.storeCapacity || a.energyCapacity) - (b.storeCapacity || b.energyCapacity);
};

var mapCS = name => Game.constructionSites[name];
var mapSpawns = name => Game.spawns[name];
var mapRooms = name => Game.rooms[name];
var mapControllers = room => room.controller;
var mapCreeps = name => Game.creeps[name];

var filterIsTrue = _ => _;
var filterMyControllers = controller => controller.my;
var filterNotMyControllers = controller => !controller.my;
var filterHurt = creep => creep.hits < creep.hitsMax;

var findTowers = {
    filter : structure => structure.structureType === STRUCTURE_TOWER
};
var findDamaged = {
    filter : structure => structure.hits < structure.hitsMax && structure.structureType !== STRUCTURE_CONTAINER
};
var findStorage = {
    filter : structure => _.sum(structure.store)
};

var reduceTowers = (towers, room) => [...towers, ...room.find(FIND_STRUCTURES, findTowers)];
var reduceDamaged = (damaged, room) => [...damaged, ...room.find(FIND_STRUCTURES, findDamaged)];
var reduceGroups = (groups, creep) => {
    var type = creep.memory.type;
    var group = groups[type] = groups[type] || [];
    group.push(creep);
    return groups; 
};
var reduceSources = (sources, room) => [...sources, ...room.find(FIND_SOURCES)];
var reduceHostiles = (hostiles, room) => [...hostiles, ...room.find(FIND_HOSTILE_STRUCTURES), ...room.find(FIND_HOSTILE_CREEPS)];
var reduceDropped = (dropped, room) => [...dropped, ...room.find(FIND_DROPPED_RESOURCES)];
var reduceStores = (stores, room) => [...stores, ...room.find(FIND_STRUCTURES, {
    filter : structure => _.sum(structure.store) < structure.storeCapacity || structure.energy < structure.energyCapacity
})];
var reduceStorage = (storage, room) => [...storage, ...room.find(FIND_STRUCTURES, findStorage)];


module.exports.loop = function () {
    
    //INIT
    
    for(var i in Memory.creeps) {
        if(!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
    
    var constructionSites = Object.keys(Game.constructionSites).map(mapCS).sort(sortCS);
    
    var spawns = Object.keys(Game.spawns).map(mapSpawns);
    
    var spawn = spawns[0];
    
    var rooms = Object.keys(Game.rooms).map(mapRooms);
    
    var controllers = rooms.map(mapControllers).filter(filterIsTrue);
    
    var my_controllers = controllers.filter(filterMyControllers);
    
    var not_my_controllers = controllers.filter(filterNotMyControllers);
    
    var toSpawn = [];
    
    var creeps = Object.keys(Game.creeps).map(mapCreeps);
    
    var towers = rooms.reduce(reduceTowers, []);
    
    var damaged = rooms.reduce(reduceDamaged, [])
    
    var groups = creeps.reduce(reduceGroups, {});
    
    var sources = rooms.reduce(reduceSources, []);
    
    var hostiles = rooms.reduce(reduceHostiles, []);
    
    var dropped = rooms.reduce(reduceDropped, []).sort(sortDropped);
    
    var stores = rooms.reduce(reduceStores, []).sort(sortStores);
    
    var storage = rooms.reduce(reduceStorage, []);
    
    var hurt = creeps.filter(filterHurt);
    
    //DO STUFF
    
    rooms.forEach(addSites);
    
    towers.forEach(tower => {
        var hostile = tower.pos.findClosestByRange(hostiles);
        if(hostile) {
            tower.attack(hostile);
        } else {
            tower.heal(tower.pos.findClosestByRange(hurt));
        }
    });
    
    //MINER CODE
    sources.forEach(source => {
        var body = [];
        var cost = 0;
        var max = spawn.room.energyCapacityAvailable;
        var parts = Math.floor(source.energyCapacity / 300 / 2);
        for(var i = 0; i < parts; i++) {
            cost += 150;
            if(cost <= max) {
                body.push(MOVE);
                body.push(WORK);
            }
        }
        makeCreep(toSpawn, source.id, "miner", body);
    });
    
    var total_time = 0, total_works = 0;
    groups.miner && groups.miner.forEach(creep => {
        var closest = creep.pos.findClosestByRange(dropped);
        if(closest) {
            creep.say(closest.energy);
        }
        var source = sources.find(source => source.id === creep.memory.id);
        switch(creep.harvest(source)) {
            case OK : {
                if(!creep.memory.finish) {
                    creep.memory.finish = new Date().getTime();
                }
                break;
            }
            case ERR_NOT_IN_RANGE : {
                creep.moveTo(source);
                break;
            }
        }
        if(creep.memory.start && creep.memory.finish) {
            total_time += (creep.memory.finish - creep.memory.start);
        }
        total_works += creep.getActiveBodyparts(WORK);
    });
    
    //CRUNCH SOME NUMBERS
    var resource_per_tick = total_works * 2;
    var ticks_to_travel = total_time / 1000 / (groups.miner ? groups.miner.length : 1) * 2; //round trip
    var capacity = 150;
    var need = Math.min(sources.length * 5, Math.floor(resource_per_tick * ticks_to_travel / capacity)); //CONTROLL SIZE
    
    var max_workers = Math.min(need, my_controllers.length * 10);
    
    //HARVESTERS CODE
    
    if((groups.harvester ? groups.harvester.length : 0) < need) {
        makeCreep(toSpawn, false, "harvester", [MOVE, CARRY, MOVE, CARRY, MOVE, CARRY]);
    }
    
    groups.harvester && groups.harvester.forEach(creep => {
        if(isWorking(creep)) {
            var store = target(creep, stores);
            if(creep.transfer(store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(store);
            }
        } else {
            var d = target(creep, dropped);
            if(creep.pickup(d) === ERR_NOT_IN_RANGE) {
                creep.moveTo(d);
                creep.memory.id = target.id;
            }
        }
    });
    
    //WORKERS CODE
    
    if((groups.worker ? groups.worker.length : 0) < max_workers) {
        sources.forEach(source => {
            makeCreep(toSpawn, false, "worker", [MOVE, MOVE, CARRY, WORK]);
        });
    }
    
    groups.worker && groups.worker.forEach((creep, i) => {
        if(isWorking(creep)) {
            if(damaged.length && i < max_workers / 2) {
                var d = target(creep, damaged);
                if(creep.repair(d) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(d);
                }
            } else if(constructionSites.length && i < max_workers / 2) {
                var cs = constructionSites[0];
                if(creep.build(cs) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(cs);
                }
            } else {
                var c = my_controllers[i % my_controllers.length];
                if(creep.upgradeController(c) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(c);
                }
            }
        } else {
            var d = target(creep, storage) || target(creep, dropped);
            if(creep.withdraw(d, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE || creep.pickup(d) === ERR_NOT_IN_RANGE) {
                creep.moveTo(d);
            }
        }
    });
    
    //FIGHTER CODE
    
    var fighterBaseBody = [TOUGH, TOUGH, MOVE, MOVE, MOVE, MOVE, ATTACK, RANGED_ATTACK]; //450
    var fighterBaseCost = 450;
    var fighterBody = [];
    var fighterCost = 0;
    
    var max = rooms.reduce((max, room) => Math.max(room.energyCapacityAvailable, max), 0);
    
    for(var i = 0; i < my_controllers.length; i++) {
        fighterCost += fighterBaseCost;
        if(fighterCost <= max) {
            fighterBody = [...fighterBody, ...fighterBaseBody];
        }
    }
    
    
    if((groups.fighter ? groups.fighter.length : 0) < 5 * rooms.length) {
        makeCreep(toSpawn, false, "fighter", fighterBody);
    }
    
    groups.fighter && groups.fighter.forEach(creep => {
        var hostile = target(creep, hostiles);
        if(hostile) {
            if(creep.attack(hostile) === ERR_NOT_IN_RANGE | creep.rangedAttack(hostile) === ERR_NOT_IN_RANGE) {
                creep.moveTo(hostile);
            }
        } else {
            creep.moveTo(40, 40);
        }
    });
    
    if((groups.claimer ? groups.claimer.length : 0) < not_my_controllers.length) {
        makeCreep(toSpawn, false, "claimer", [MOVE, CLAIM]);
    }
    
    not_my_controllers.forEach(ctrl => {
        if(!Game.creeps[Memory.claimers[ctrl.id]]) {
            var creep = (groups.claimer || []).find(creep => !creep.memory.id);
            if(creep) {
                Memory.claimers[ctrl.id] = creep.name;
                creep.memory.id = ctrl.id;
            }
        }
    });
    
    groups.claimer && groups.claimer.forEach(creep => {
       var ctrl = not_my_controllers.find(ctrl => ctrl.id === creep.memory.id);
       if(ctrl) {
            if(creep.reserveController(ctrl) === ERR_NOT_IN_RANGE) {
                creep.moveTo(ctrl);
            } else {
                var room = creep.room;
                if(!room.memory.freeSpaces) {
                    room.memory.freeSpaces = room.lookForAtArea(LOOK_TERRAIN, 5, 5, 45, 45, true).filter(terrain => terrain.terrain === "plain").length;
                }
                if(room.memory.freeSpaces >= 1000) {
                    creep.claimController(ctrl);
                }
            }
       }
    });
    
    if((groups.expander ? groups.expander.length : 0) < 1) {
        makeCreep(toSpawn, false, "expander", [MOVE]);
    }
    
    groups.expander && groups.expander.forEach(creep => {
        if(!creep.memory.id) {
            rooms.forEach(room => {
               var exits = Game.map.describeExits(room.name); 
               var unvisited = Object.keys(exits).map(key => exits[key]).filter(name => !Game.rooms[name]);
               creep.memory.id = creep.memory.id || unvisited[0];
            });
        } else {
            if(creep.room.name !== creep.memory.id) {
                var route = Game.map.findRoute(creep.room.name, creep.memory.id);
                var exit = creep.pos.findClosestByPath(route[0].exit);
                var path = creep.pos.findPathTo(exit, { 
                    maxRooms : 1
                });
                creep.moveByPath(path);
            } else {
                creep.moveTo(25, 25);
                creep.say("mine");
            }
        }
    });
    
    if(toSpawn.length) {
        for(var i = 0; i < spawns.length; i++) {
            if(toSpawn[0](spawns[i])) {
                break;
            }
        }
    }
    
    console.log(toSpawn.length, need, Math.floor(dropped.reduce((total, dropped) => (dropped.energy || 0) + total, 0) / 150));
    console.log(Object.keys(groups).sort().map(key => [key, groups[key].length]));
};

function target(creep, targets) {
    var target = targets.find(target => target.id === creep.memory.target) || targets[0];
    if(target) {
        creep.memory.target = target.id;
    }
    return target;
}

function isWorking(creep) {
    if(!creep.memory.working && creep.carry.energy === creep.carryCapacity) { //if i am gathering and i am done
        creep.memory.working = true;
    } else if(creep.memory.working && creep.carry.energy === 0) { //if i am working and i am done
        creep.memory.working = false;
    }
    return creep.memory.working;
}

function makeCreep(toSpawn, id, type, body) {
    var plural = `${type}s`;
    if(!id || !Game.creeps[Memory[plural][id]]) {
        toSpawn.push(spawn => {
            var result = spawn.createCreep(body, "creep_" + (new Date()).getTime(), {
                type,
                id,
                start : new Date().getTime()
            });
            if(_.isString(result)) {
                if(id) {
                    Memory[plural][id] = result;
                }   
                return true;
            }
        });
    }
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