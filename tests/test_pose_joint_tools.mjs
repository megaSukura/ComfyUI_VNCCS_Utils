import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "../web/vendor/three/three.module.js";
import { TransformControls } from "../web/vendor/three/TransformControls.js";
import { JointLimiter } from "../web/pose_studio/joint_limits.mjs";
import { createScene, Element } from "./helpers/pose_studio_scene.mjs";

const DEG = Math.PI / 180;
const noop = () => {};

function rigScene() {
    const scene = createScene({ skinned: true });
    const { viewer } = scene;
    viewer.TransformControls = TransformControls;
    viewer._initIKHelpers();
    viewer.transform = new TransformControls(viewer.camera, viewer.canvas);
    viewer.scene.add(viewer.transform);
    viewer.scene.updateMatrixWorld(true);
    return scene;
}

const restDirection = bone => new THREE.Vector3().fromArray(bone.userData.tailPos)
    .sub(new THREE.Vector3().fromArray(bone.userData.headPos)).normalize();
const worldPosition = bone => bone.getWorldPosition(new THREE.Vector3());
const worldDirection = (from, to) => worldPosition(to).sub(worldPosition(from)).normalize();
const mirror = q => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
const sameRotation = (a, b) => Math.abs(a.dot(b)) > 1 - 1e-9;

// Signed bend of `bone` relative to its parent around the rest hinge axis, carried by the parent.
function hingeState(viewer, name) {
    const bone = viewer.bones[name];
    const parent = bone.parent;
    const child = bone.children.find(item => item.isBone);
    const hinge = new THREE.Vector3().crossVectors(restDirection(parent), restDirection(bone)).normalize()
        .applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()));
    const upper = worldDirection(parent, bone);
    const lower = worldDirection(bone, child);
    return {
        bend: Math.atan2(new THREE.Vector3().crossVectors(upper, lower).dot(hinge), upper.dot(lower)) / DEG,
        offPlane: Math.asin(Math.min(1, Math.abs(lower.dot(hinge)))) / DEG,
    };
}

function rotateAroundRestHinge(viewer, name, degrees) {
    const bone = viewer.bones[name];
    const hinge = new THREE.Vector3().crossVectors(restDirection(bone.parent), restDirection(bone)).normalize();
    bone.quaternion.setFromAxisAngle(hinge, degrees * DEG);
    bone.updateMatrixWorld(true);
}

test("joint limits stop elbows and knees from bending backwards or folding through themselves", () => {
    const { viewer } = rigScene();
    viewer.setJointLimitsEnabled(true);
    for (const [name, restBend] of [["lowerarm_l", hingeState(viewer, "lowerarm_l").bend], ["calf_r", hingeState(viewer, "calf_r").bend]]) {
        rotateAroundRestHinge(viewer, name, -restBend - 60);
        assert.equal(viewer.applyJointLimits(viewer.bones[name]), true, `${name} hyperextension is clamped`);
        const extended = hingeState(viewer, name);
        assert.ok(Math.abs(extended.bend + 10) < 1e-3, `${name} stops 10 degrees past straight: ${extended.bend}`);

        rotateAroundRestHinge(viewer, name, 175 - restBend);
        assert.equal(viewer.applyJointLimits(viewer.bones[name]), true, `${name} overflexion is clamped`);
        assert.ok(hingeState(viewer, name).bend <= 155 + 1e-3);
    }
});

test("joint limits keep rotations in range unchanged and are off by default", () => {
    const { viewer } = rigScene();
    const forearm = viewer.bones.lowerarm_l;
    rotateAroundRestHinge(viewer, "lowerarm_l", -120);
    const bent = forearm.quaternion.clone();
    assert.equal(viewer.jointLimitsEnabled, false);
    assert.equal(viewer.applyJointLimits(forearm), false);
    assert.ok(sameRotation(forearm.quaternion, bent));

    viewer.setJointLimitsEnabled(true);
    rotateAroundRestHinge(viewer, "lowerarm_l", 30);
    const inRange = forearm.quaternion.clone();
    assert.equal(viewer.applyJointLimits(forearm), false);
    assert.ok(forearm.quaternion.equals(inRange), "a rotation inside the range is not rewritten");
    assert.equal(viewer.applyJointLimits(viewer.bones.pelvis), false, "the pelvis orientation is never limited");
});

test("left and right joints share mirrored ranges", () => {
    const { viewer } = rigScene();
    const limiter = new JointLimiter(THREE);
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const names = ["clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot", "ball"];
    for (const name of names) {
        const left = viewer.bones[`${name}_l`];
        const right = viewer.bones[`${name}_r`];
        assert.ok(limiter.hasLimit(left) && limiter.hasLimit(right), name);
        for (let i = 0; i < 25; i++) {
            const axis = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
            const rotation = new THREE.Quaternion().setFromAxisAngle(axis, (random() * 2 - 1) * Math.PI);
            left.quaternion.copy(rotation);
            right.quaternion.copy(mirror(rotation));
            limiter.clamp(left);
            limiter.clamp(right);
            assert.ok(sameRotation(right.quaternion, mirror(left.quaternion)), `${name} sample ${i}`);
        }
    }
});

test("limited leg IK turns the thigh so the knee bends only around its hinge", () => {
    const { viewer } = rigScene();
    const thigh = viewer.bones.thigh_l;
    // A thigh twisted by 80 degrees points the knee hinge forward; an unconstrained
    // solve would then bend the knee sideways to reach a kick-back target.
    thigh.quaternion.setFromAxisAngle(restDirection(thigh), 80 * DEG);
    thigh.updateMatrixWorld(true);
    const target = worldPosition(viewer.bones.foot_l).add(new THREE.Vector3(0, 2.5, -2.5));

    const solve = enabled => {
        thigh.quaternion.setFromAxisAngle(restDirection(thigh), 80 * DEG);
        viewer.bones.calf_l.quaternion.identity();
        viewer.bones.foot_l.updateMatrixWorld(true);
        thigh.updateMatrixWorld(true);
        viewer.setJointLimitsEnabled(enabled);
        viewer.ikController.effectors.foot_l.position.copy(target);
        viewer.selectedIKEffector = viewer.ikController.effectors.foot_l;
        viewer.solveIKForEffector();
        viewer.selectedIKEffector = null;
        return { knee: hingeState(viewer, "calf_l"), reach: worldPosition(viewer.bones.foot_l).distanceTo(target) };
    };

    const free = solve(false);
    assert.ok(free.knee.offPlane > 20, `the unconstrained knee leaves its hinge plane: ${free.knee.offPlane}`);
    const limited = solve(true);
    assert.ok(limited.knee.offPlane <= 10 + 1e-3, `knee stays within 10 degrees of its hinge: ${limited.knee.offPlane}`);
    assert.ok(limited.knee.bend > 30, `knee flexes backwards: ${limited.knee.bend}`);
    assert.ok(limited.reach < 1e-3, `the foot still reaches the target: ${limited.reach}`);
});

test("limited spine IK keeps every vertebra inside its range", () => {
    const limiter = new JointLimiter(THREE);
    const vertebrae = ["spine_01", "spine_02", "spine_03", "neck_01"];
    const solve = enabled => {
        const { viewer } = rigScene();
        viewer.setJointLimitsEnabled(enabled);
        const head = viewer.ikController.effectors.head;
        head.position.copy(worldPosition(viewer.bones.head)).add(new THREE.Vector3(0, -6, -6));
        viewer.selectedIKEffector = head;
        viewer.solveIKForEffector();
        return vertebrae.filter(name => limiter.clamp(viewer.bones[name]));
    };
    assert.ok(solve(false).length > 0, "the backbend target overextends an unlimited spine");
    assert.deepEqual(solve(true), []);
});

test("Reset Joint restores the selected joint, keeps bone lengths, and is one undo step", () => {
    const { w, viewer, node } = rigScene();
    viewer.updateBoneLengthScale("upper_arm_l", 0.9);
    const shapedRest = viewer.shapedBoneRestPositions.lowerarm_l.clone();
    assert.ok(shapedRest.distanceTo(viewer.initialBoneStates.lowerarm_l.position) > 1e-3, "the slider moved the elbow");

    const forearm = viewer.bones.lowerarm_l;
    viewer.selectBone(forearm);
    forearm.rotation.set(0.4, 0.2, 0.1);
    forearm.position.addScalar(0.3);
    viewer.bones.hand_l.rotation.set(0.5, 0, 0);
    viewer.bones.index_02_l.rotation.set(0.3, 0, 0);
    const history = viewer.history.length;

    assert.equal(w.resetSelectedBone(), true);
    assert.ok(forearm.quaternion.equals(new THREE.Quaternion()), "the rotation returns to rest");
    assert.ok(forearm.position.distanceTo(shapedRest) < 1e-9, "the shaped rest position is kept");
    assert.equal(viewer.history.length, history + 1);
    let saved = JSON.parse(node.widgets[0].value).characters[0].poses[0].bones;
    assert.equal(saved.lowerarm_l, undefined);
    assert.ok(saved.hand_l, "children keep their rotation");

    assert.equal(w.resetSelectedBone({ includeChildren: true }), true);
    saved = JSON.parse(node.widgets[0].value).characters[0].poses[0].bones;
    assert.equal(saved.hand_l, undefined);
    assert.equal(saved.index_02_l, undefined);
    assert.equal(viewer.history.length, history + 2);

    assert.equal(w.resetSelectedBone({ includeChildren: true }), false, "a joint already at rest records nothing");
    assert.equal(viewer.history.length, history + 2);

    viewer.undo();
    assert.ok(Math.abs(viewer.bones.hand_l.rotation.x - 0.5) < 1e-9, "undo restores the children");
    viewer.deselectBone();
    assert.equal(w.resetSelectedBone(), false, "nothing is selected");
});

test("Reset Joint in animation mode keys the reset on the current frame", () => {
    const { w, viewer } = rigScene();
    w.exportParams.editor_mode = "animation";
    w.applyEditorMode?.();
    assert.equal(w.isAnimationMode(), true);
    const forearm = viewer.bones.lowerarm_l;
    viewer.selectBone(forearm);
    forearm.rotation.set(0.6, 0, 0);
    viewer.dispatchPoseChange();
    w.animationState.currentFrame = 3;
    assert.equal(w.resetSelectedBone(), true);
    const track = w.animationState.tracks?.lowerarm_l;
    assert.ok(track, "the joint has an animation track");
    assert.ok(track.keys.some(key => key.frame === 3));
});

test("Alt+R resets the selected joint only while Pose Studio has the interaction focus", () => {
    const scene = rigScene();
    const { w, viewer, context } = scene;
    const listeners = {};
    scene.document.addEventListener = (type, fn) => { listeners[type] = fn; };
    context.window.addEventListener = (type, fn) => { listeners[type] = fn; };
    const inside = new Element();
    const outside = new Element();
    w.container.contains = node => node === inside || node === w.container;
    w.container.isConnected = true;
    w.installCaptureViewShortcut();
    const press = values => {
        const event = { ctrlKey: false, shiftKey: false, altKey: true, metaKey: false, key: "r", code: "KeyR", target: inside,
            prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation: noop, ...values };
        listeners.keydown(event);
        return event;
    };
    const resets = [];
    w.resetSelectedBone = options => resets.push(options);

    viewer.selectBone(viewer.bones.lowerarm_l);
    assert.equal(press().prevented, false, "no focus yet");
    listeners.pointerdown({ target: inside });
    assert.equal(press({ ctrlKey: true }).prevented, false);
    assert.equal(press({ altKey: false }).prevented, false);
    assert.equal(press({ target: { ...inside, matches: () => true } }).prevented, false, "typing in a field is left alone");
    assert.equal(press().prevented, true);
    assert.equal(press({ shiftKey: true, key: "R" }).prevented, true);
    assert.equal(JSON.stringify(resets), JSON.stringify([{ includeChildren: false }, { includeChildren: true }]));

    viewer.deselectBone();
    assert.equal(press().prevented, false, "without a selected joint the key passes through");
    viewer.selectBone(viewer.bones.lowerarm_l);
    w.host = { embedded: true };
    assert.equal(press().prevented, false, "UniCanvas keeps its own keys");
});

test("the Joint Limits setting is saved with the scene and applied to the viewer", () => {
    const { w, viewer, node } = rigScene();
    assert.equal(w.exportParams.joint_limits, false);
    const data = JSON.parse(node.widgets[0].value);
    data.export.joint_limits = true;
    node.widgets[0].value = JSON.stringify(data);
    w.hydrateCharacterSceneModels = async () => {};
    w.setInterfaceMode = noop;
    viewer.setSkinMode = noop;
    w.loadFromNode();
    assert.equal(w.exportParams.joint_limits, true);
    assert.equal(viewer.jointLimitsEnabled, true);
    w.syncToNode(false, { skipCaptureUpload: true });
    assert.equal(JSON.parse(node.widgets[0].value).export.joint_limits, true);
});
