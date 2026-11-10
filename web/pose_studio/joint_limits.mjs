/**
 * Optional anatomical joint limits for Pose Studio.
 *
 * Every rig bone rests with an identity rotation, so a local rotation is
 * expressed in the parent's mesh-aligned frame (+X character left, +Y up,
 * +Z front). Each limited joint gets a frame built from the rest geometry:
 * Y follows the bone, X is its flexion axis and Z = X x Y. A local rotation is
 * split into a twist around Y and a swing of the bone direction; the swing's
 * rotation-vector components on X (flexion) and Z (lateral) and the twist
 * angle are clamped independently.
 *
 * Ranges are loose human ranges of motion in degrees, relative to the rest
 * pose, written for left and centre bones. Right-side frames are mirror
 * images, so their lateral and twist ranges are negated. `fromStraight`
 * hinge ranges are measured from a straight joint instead of the rest bend.
 */

const DEG = Math.PI / 180;

const JOINT_LIMITS = {
    spine_01: { axis: [1, 0, 0], flexion: [-25, 40], lateral: [-25, 25], twist: [-30, 30] },
    spine_02: { axis: [1, 0, 0], flexion: [-25, 40], lateral: [-25, 25], twist: [-30, 30] },
    spine_03: { axis: [1, 0, 0], flexion: [-25, 40], lateral: [-25, 25], twist: [-30, 30] },
    neck_01: { axis: [1, 0, 0], flexion: [-45, 50], lateral: [-40, 40], twist: [-50, 50] },
    head: { axis: [1, 0, 0], flexion: [-45, 40], lateral: [-35, 35], twist: [-50, 50] },
    // Flexion raises the clavicle, lateral pulls it back.
    clavicle: { axis: [0, 0, 1], flexion: [-15, 40], lateral: [-30, 30], twist: [-30, 30] },
    // Flexion swings the limb forward, lateral is abduction.
    upperarm: { axis: [-1, 0, 0], flexion: [-60, 170], lateral: [-80, 140], twist: [-90, 90] },
    lowerarm: { axis: "bend", fromStraight: true, flexion: [-10, 150], lateral: [-15, 15], twist: [-90, 90] },
    hand: { axis: "palm", flexion: [-70, 80], lateral: [-35, 35], twist: [-45, 45] },
    thigh: { axis: [-1, 0, 0], flexion: [-40, 140], lateral: [-40, 100], twist: [-60, 60] },
    calf: { axis: "bend", fromStraight: true, flexion: [-10, 155], lateral: [-10, 10], twist: [-30, 30] },
    // Flexion points the foot and curls the toes down.
    foot: { axis: [1, 0, 0], flexion: [-45, 45], lateral: [-35, 35], twist: [-35, 35] },
    ball: { axis: [1, 0, 0], flexion: [-70, 45], lateral: [-15, 15], twist: [-15, 15] },
};

const clampRange = (value, [min, max]) => Math.min(max, Math.max(min, value));
const outsideRange = (value, [min, max]) => Math.max(0, min - value, value - max);
const ANGLES = ["flexion", "lateral", "twist"];
// Past a limit a gizmo drag slides along it while the slide turns the bone around an axis
// within 50 degrees of the drag's axis, slows down until 70 degrees and stops beyond.
const SLIDE_FULL = Math.cos(50 * DEG);
const SLIDE_NONE = Math.cos(70 * DEG);

export class JointLimiter {
    constructor(THREE) {
        this.THREE = THREE;
        this._frame = new THREE.Quaternion();
        this._inverseFrame = new THREE.Quaternion();
        this._local = new THREE.Quaternion();
        this._twist = new THREE.Quaternion();
        this._swing = new THREE.Quaternion();
        this._step = new THREE.Quaternion();
        this._worldQuat = new THREE.Quaternion();
        this._parentQuat = new THREE.Quaternion();
        this._basis = new THREE.Matrix4();
        this._x = new THREE.Vector3();
        this._y = new THREE.Vector3();
        this._z = new THREE.Vector3();
        this._a = new THREE.Vector3();
        this._b = new THREE.Vector3();
        this._yAxis = new THREE.Vector3(0, 1, 0);
    }

    hasLimit(bone) {
        return !!JOINT_LIMITS[bone?.name?.replace(/_[lr]$/, "")];
    }

    _boneDirection(bone, target) {
        const { headPos, tailPos } = bone?.userData || {};
        if (!headPos || !tailPos) return false;
        target.fromArray(tailPos).sub(this._b.fromArray(headPos));
        if (target.lengthSq() < 1e-12) return false;
        target.normalize();
        return true;
    }

    _childHead(bone, prefix) {
        const child = bone.children.find(item => item.isBone && item.name.startsWith(prefix));
        return child?.userData?.headPos || null;
    }

    // Writes the joint frame into this._frame/_x/_y/_z and returns the ranges in radians.
    _resolve(bone) {
        const spec = JOINT_LIMITS[bone?.name?.replace(/_[lr]$/, "")];
        if (!spec) return null;
        const mirrored = bone.name.endsWith("_r");
        const x = this._x, y = this._y;
        if (!this._boneDirection(bone, y)) return null;

        let restBend = 0;
        if (spec.axis === "bend") {
            if (!this._boneDirection(bone.parent, this._a)) return null;
            x.crossVectors(this._a, y);
            restBend = this._a.angleTo(y);
        } else if (spec.axis === "palm") {
            // The palm's knuckle line; the sign makes positive flexion curl toward the palm on both sides.
            const index = this._childHead(bone, "index_01");
            const pinky = this._childHead(bone, "pinky_01");
            if (!index || !pinky) return null;
            if (mirrored) x.fromArray(index).sub(this._a.fromArray(pinky));
            else x.fromArray(pinky).sub(this._a.fromArray(index));
        } else {
            x.fromArray(spec.axis);
            if (mirrored) x.set(x.x, -x.y, -x.z);
        }
        x.addScaledVector(y, -x.dot(y));
        if (x.lengthSq() < 1e-10) return null;
        x.normalize();
        this._z.crossVectors(x, y);
        this._basis.makeBasis(x, y, this._z);
        this._frame.setFromRotationMatrix(this._basis);
        this._inverseFrame.copy(this._frame).invert();

        const offset = spec.fromStraight ? -restBend : 0;
        const side = ([min, max]) => mirrored ? [-max * DEG, -min * DEG] : [min * DEG, max * DEG];
        return {
            hinge: spec.axis === "bend",
            flexion: [Math.min(0, spec.flexion[0] * DEG + offset), Math.max(0, spec.flexion[1] * DEG + offset)],
            lateral: side(spec.lateral),
            twist: side(spec.twist),
        };
    }

    // Split a bone's local rotation into the frame's flexion, lateral and twist angles.
    _decompose(bone, quaternion = bone.quaternion) {
        const limit = this._resolve(bone);
        if (!limit) return null;
        const q = this._local.copy(this._inverseFrame).multiply(quaternion).multiply(this._frame);
        if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);

        const twistLength = Math.hypot(q.y, q.w);
        if (twistLength < 1e-9) this._twist.identity();
        else this._twist.set(0, q.y / twistLength, 0, q.w / twistLength);
        const twist = 2 * Math.atan2(this._twist.y, this._twist.w);

        const swing = this._swing.copy(this._twist).invert().premultiply(q);
        if (swing.w < 0) swing.set(-swing.x, -swing.y, -swing.z, -swing.w);
        const sine = Math.hypot(swing.x, swing.z);
        const angle = 2 * Math.atan2(sine, swing.w);
        return {
            limit,
            flexion: sine > 1e-9 ? swing.x / sine * angle : 0,
            lateral: sine > 1e-9 ? swing.z / sine * angle : 0,
            twist,
        };
    }

    // Rebuild a local rotation from frame angles; the frame is the one last resolved for the bone.
    _compose(target, flexion, lateral, twist) {
        const swingAngle = Math.hypot(flexion, lateral);
        if (swingAngle < 1e-9) this._swing.identity();
        else this._swing.setFromAxisAngle(this._a.set(flexion / swingAngle, 0, lateral / swingAngle), swingAngle);
        this._twist.setFromAxisAngle(this._yAxis, twist);
        return target.copy(this._frame).multiply(this._swing).multiply(this._twist).multiply(this._inverseFrame);
    }

    /** Clamp a bone's local rotation to its range of motion. Returns true when it changed. */
    clamp(bone) {
        const state = this._decompose(bone);
        if (!state) return false;
        const { limit, flexion, lateral, twist } = state;
        const nextFlexion = clampRange(flexion, limit.flexion);
        const nextLateral = clampRange(lateral, limit.lateral);
        const nextTwist = clampRange(twist, limit.twist);
        // Rotations already on a boundary decompose with rounding error; leave them alone.
        if (Math.abs(nextFlexion - flexion) + Math.abs(nextLateral - lateral) + Math.abs(nextTwist - twist) < 1e-7) return false;
        this._compose(bone.quaternion, nextFlexion, nextLateral, nextTwist);
        return true;
    }

    // Rotation axis, scaled by the sine of half the angle, that turns `from` into `to` in the parent frame.
    _turnAxis(to, from) {
        const q = from.clone().invert().premultiply(to);
        return q.w < 0 ? new this.THREE.Vector3(-q.x, -q.y, -q.z) : new this.THREE.Vector3(q.x, q.y, q.z);
    }

    /**
     * Turn a bone from `from` toward `to` within its range. The bone follows up to
     * the limit. Past it, it slides along the limit while that still turns it about
     * the way the drag does (a twisted knee keeps bending) and stops when the drag
     * pushes against the limit, so a blocked axis never turns the bone around
     * another one. Angles already out of range may move back but not further out.
     * Writes bone.quaternion and returns true when the motion was limited.
     */
    limitRotation(bone, from, to) {
        const start = this._decompose(bone, from);
        if (!start) {
            bone.quaternion.copy(to);
            return false;
        }
        const ranges = ANGLES.map(key => [Math.min(start.limit[key][0], start[key]), Math.max(start.limit[key][1], start[key])]);
        const anglesOf = quaternion => {
            const state = this._decompose(bone, quaternion);
            return ANGLES.map(key => state[key]);
        };
        const inRange = angles => angles.every((value, i) => outsideRange(value, ranges[i]) < 1e-9);
        const target = anglesOf(to);
        if (inRange(target)) {
            bone.quaternion.copy(to);
            return false;
        }

        let low = 0, high = 1;
        for (let i = 0; i < 24; i++) {
            const middle = (low + high) / 2;
            if (inRange(anglesOf(this._step.slerpQuaternions(from, to, middle)))) low = middle;
            else high = middle;
        }
        const reached = bone.quaternion.slerpQuaternions(from, to, low).clone();
        const slid = this._compose(new this.THREE.Quaternion(), ...target.map((value, i) => clampRange(value, ranges[i])));
        const drag = this._turnAxis(to, reached), slide = this._turnAxis(slid, reached);
        const cosine = drag.dot(slide) / (drag.length() * slide.length() || 1);
        const amount = clampRange((cosine - SLIDE_NONE) / (SLIDE_FULL - SLIDE_NONE), [0, 1]);
        if (amount > 0) bone.quaternion.slerpQuaternions(reached, slid, amount);
        return true;
    }

    /**
     * Twist the root of a two-bone chain around its own axis by the smallest
     * angle that lets the mid joint (elbow/knee) point at the target within its
     * hinge range, preferring a twist the root itself allows. A chain that can
     * already reach the target in range is left untouched.
     */
    alignHinge(rootBone, midBone, targetPos) {
        const root = this._decompose(rootBone);
        const limit = this._resolve(midBone);
        if (!limit?.hinge) return false;
        const THREE = this.THREE;
        rootBone.getWorldQuaternion(this._worldQuat);
        const hinge = this._x.clone().applyQuaternion(this._worldQuat);
        const rest = this._y.clone().applyQuaternion(this._worldQuat);

        const midPos = midBone.getWorldPosition(new THREE.Vector3());
        const axis = midPos.clone().sub(rootBone.getWorldPosition(new THREE.Vector3()));
        const want = targetPos.clone().sub(midPos);
        if (axis.lengthSq() < 1e-12 || want.lengthSq() < 1e-12) return false;
        axis.normalize();
        want.normalize();

        const turn = new THREE.Quaternion();
        const turnedHinge = new THREE.Vector3();
        const turnedRest = new THREE.Vector3();
        const turnedSide = new THREE.Vector3();
        // How far the mid joint (and the root twist) would leave their ranges after turning the root.
        const violation = angle => {
            turn.setFromAxisAngle(axis, angle);
            turnedHinge.copy(hinge).applyQuaternion(turn);
            turnedRest.copy(rest).applyQuaternion(turn);
            turnedSide.crossVectors(turnedHinge, turnedRest);
            const x = want.dot(turnedHinge), y = want.dot(turnedRest), z = want.dot(turnedSide);
            const sine = Math.hypot(x, z);
            const swing = Math.atan2(sine, y);
            const flexion = sine > 1e-9 ? z / sine * swing : 0;
            const lateral = sine > 1e-9 ? -x / sine * swing : 0;
            return outsideRange(flexion, limit.flexion) + outsideRange(lateral, limit.lateral)
                + (root ? outsideRange(root.twist + angle, root.limit.twist) : 0);
        };

        let best = { angle: 0, violation: violation(0) };
        if (best.violation < 1e-7) return false;
        let found = null;
        for (let step = 1; step <= 180 && found === null; step++) {
            for (const sign of [1, -1]) {
                const angle = sign * step * DEG;
                const value = violation(angle);
                if (value < 1e-7) {
                    // Refine to the boundary so the twist grows continuously while dragging.
                    let invalid = sign * (step - 1) * DEG;
                    found = angle;
                    for (let i = 0; i < 20; i++) {
                        const middle = (invalid + found) / 2;
                        if (violation(middle) < 1e-7) found = middle;
                        else invalid = middle;
                    }
                    break;
                }
                if (value < best.violation) best = { angle, violation: value };
            }
        }
        const angle = found ?? best.angle;
        if (Math.abs(angle) < 1e-9) return false;

        turn.setFromAxisAngle(axis, angle);
        this._worldQuat.premultiply(turn);
        if (rootBone.parent) this._worldQuat.premultiply(rootBone.parent.getWorldQuaternion(this._parentQuat).invert());
        rootBone.quaternion.copy(this._worldQuat);
        rootBone.updateMatrixWorld(true);
        return true;
    }
}
