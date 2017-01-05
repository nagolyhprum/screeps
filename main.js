
Memory.miners = Memory.miners || {
};

Memory.harvesters = Memory.harvesters || {
};
 
Memory.upgraders = Memory.upgraders || {
};

module.exports.loop = function () {
    
    for(var i in Memory.creeps) {
        if(!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
    
    var spawns = Object.keys(Game.spawns).map(name => Game.spawns[name]);
    
    var spawn = spawns[0];
    
    var rooms = Object.keys(Game.rooms).map(name => Game.rooms[name]);
    
    var creeps = Object.keys(Game.creeps).map(name => Game.creeps[name]);
    
    var groups = creeps.reduce((groups, creep) => {
        var type = creep.memory.type;
        var group = groups[type] = groups[type] || [];
        group.push(creep);
        return groups; 
    }, {});
    
    var sources = rooms.reduce((sources, room) => [...sources, ...room.find(FIND_SOURCES)], []);
    
    var dropped = rooms.reduce((sources, room) => [...sources, ...room.find(FIND_DROPPED_RESOURCES)], []).sort((a, b) => b.energy - a.energy);
    
    //MINER CODE
    sources.forEach(source => {
        var body = [];
        var cost = 0;
        var max = spawn.energyCapacity;
        var parts = source.energyCapacity / 300 / 2;
        for(var i = 0; i < parts; i++) {
            cost += 150;
            if(cost <= max) {
                body.push(MOVE);
                body.push(WORK);
            }
        }
        makeCreep(spawns, source.id, "miner", body);
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
    
    var resource_per_tick = total_works * 2;
    
    var ticks_to_travel = total_time / 1000 / (groups.miner ? groups.miner.length : 1) * 2; //round trip
    
    var capacity = 50;
    
    var need = Math.floor(resource_per_tick * ticks_to_travel / capacity / 2);
    
    console.log(need);
    
    //HARVESTERS CODE
    
    if(need && (!groups.harvester || groups.harvester.length < need)) {
        sources.forEach(source => {
            makeCreep(spawns, false, "harvester", [MOVE, CARRY]);
        });
    }
    
    groups.harvester && groups.harvester.forEach(creep => {
        if(isWorking(creep)) {
            var target = spawns[0];
            if(creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
            }
        } else {
            var target = dropped.find(dropped => dropped.id === creep.memory.id) || dropped[0];
            if(creep.pickup(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
                creep.memory.id = target.id;
            }
        }
    });
    
    //WORKERS CODE
    if(need && (!groups.upgrader || groups.upgrader.length < need)) {
        sources.forEach(source => {
            makeCreep(spawns, false, "upgrader", [MOVE, MOVE, CARRY, WORK]);
        });
    }
    
    groups.upgrader && groups.upgrader.forEach(creep => {
        if(isWorking(creep)) {
            var target = creep.room.controller;
            if(creep.upgradeController(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
            }
        } else {
            var target = dropped.find(dropped => dropped.id === creep.memory.id) || dropped[0];
            if(creep.pickup(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
                creep.memory.id = target.id;
            }
        }
    });
    
    //FIGHTER CODE
    
    if((groups.upgrader && groups.upgrader.length >= need) && (groups.harvester && groups.harvester.length >= need) && (groups.miner && groups.miner.length >= sources.length)) {
        spawn.createCreep([TOUGH, TOUGH, MOVE, MOVE, MOVE, ATTACK], undefined, {
            type : "fighter"
        });
    }
    
    groups.fighter && groups.fighter.forEach(creep => {
        creep.moveTo(25, 40);
    })
};

function isWorking(creep) {
    if(!creep.memory.working && creep.carry.energy === creep.carryCapacity) { //if i am gathering and i am done
        creep.memory.working = true;
    } else if(creep.memory.working && creep.carry.energy === 0) { //if i am working and i am done
        creep.memory.working = false;
    }
    return creep.memory.working;
}

function makeCreep(spawns, id, type, body) {
    var plural = `${type}s`;
    if(!Game.creeps[Memory[plural][id]]) {
        var result = spawns[0].createCreep(body, undefined, {
            type,
            id,
            start : new Date().getTime()
        });
        if(_.isString(result) && id) {
            Memory[plural][id] = result;
        }   
    }
    
}