"use strict";(self.webpackChunkbilliards=self.webpackChunkbilliards||[]).push([[668],{"./node_modules/three/build/three.module.js"(e,t,r){r.d(t,{JeP:()=>WebGLRenderer});var i=r("./node_modules/three/build/three.core.js");/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */function WebGLAnimation(){let e=null,t=!1,r=null,i=null;function onAnimationFrame(t,a){r(t,a),i=e.requestAnimationFrame(onAnimationFrame)}return{start:function(){!0===t||null===r||null!==e&&(i=e.requestAnimationFrame(onAnimationFrame),t=!0)},stop:function(){null!==e&&e.cancelAnimationFrame(i),t=!1},setAnimationLoop:function(e){r=e},setContext:function(t){e=t}}}function WebGLAttributes(e){let t=new WeakMap;function createBuffer(t,r){let i,a=t.array,n=t.usage,o=a.byteLength,s=e.createBuffer();if(e.bindBuffer(r,s),e.bufferData(r,a,n),t.onUploadCallback(),a instanceof Float32Array)i=e.FLOAT;else if("u">typeof Float16Array&&a instanceof Float16Array)i=e.HALF_FLOAT;else if(a instanceof Uint16Array)i=t.isFloat16BufferAttribute?e.HALF_FLOAT:e.UNSIGNED_SHORT;else if(a instanceof Int16Array)i=e.SHORT;else if(a instanceof Uint32Array)i=e.UNSIGNED_INT;else if(a instanceof Int32Array)i=e.INT;else if(a instanceof Int8Array)i=e.BYTE;else if(a instanceof Uint8Array)i=e.UNSIGNED_BYTE;else if(a instanceof Uint8ClampedArray)i=e.UNSIGNED_BYTE;else throw Error("THREE.WebGLAttributes: Unsupported buffer data format: "+a);return{buffer:s,type:i,bytesPerElement:a.BYTES_PER_ELEMENT,version:t.version,size:o}}function updateBuffer(t,r,i){let a=r.array,n=r.updateRanges;if(e.bindBuffer(i,t),0===n.length)e.bufferSubData(i,0,a);else{n.sort((e,t)=>e.start-t.start);let t=0;for(let e=1;e<n.length;e++){let r=n[t],i=n[e];i.start<=r.start+r.count+1?r.count=Math.max(r.count,i.start+i.count-r.start):n[++t]=i}n.length=t+1;for(let t=0,r=n.length;t<r;t++){let r=n[t];e.bufferSubData(i,r.start*a.BYTES_PER_ELEMENT,a,r.start,r.count)}r.clearUpdateRanges()}r.onUploadCallback()}return{get:function(e){return e.isInterleavedBufferAttribute&&(e=e.data),t.get(e)},remove:function(r){r.isInterleavedBufferAttribute&&(r=r.data);let i=t.get(r);i&&(e.deleteBuffer(i.buffer),t.delete(r))},update:function(e,r){if(e.isInterleavedBufferAttribute&&(e=e.data),e.isGLBufferAttribute){let r=t.get(e);(!r||r.version<e.version)&&t.set(e,{buffer:e.buffer,type:e.type,bytesPerElement:e.elementSize,version:e.version});return}let i=t.get(e);if(void 0===i)t.set(e,createBuffer(e,r));else if(i.version<e.version){if(i.size!==e.array.byteLength)throw Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");updateBuffer(i.buffer,e,r),i.version=e.version}}}}let a={alphahash_fragment:`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,alphahash_pars_fragment:`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,alphamap_fragment:`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,alphamap_pars_fragment:`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,alphatest_fragment:`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,alphatest_pars_fragment:`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,aomap_fragment:`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,aomap_pars_fragment:`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,batching_pars_vertex:`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,batching_vertex:`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,begin_vertex:`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,beginnormal_vertex:`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bsdfs:`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,iridescence_fragment:`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,bumpmap_pars_fragment:`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,clipping_planes_fragment:`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,clipping_planes_pars_fragment:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,clipping_planes_pars_vertex:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,clipping_planes_vertex:`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,color_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,color_pars_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,color_pars_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,color_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,common:`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,cube_uv_reflection_fragment:`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,defaultnormal_vertex:`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,displacementmap_pars_vertex:`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,displacementmap_vertex:`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,emissivemap_fragment:`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,emissivemap_pars_fragment:`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,colorspace_fragment:"gl_FragColor = linearToOutputTexel( gl_FragColor );",colorspace_pars_fragment:`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,envmap_fragment:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,envmap_common_pars_fragment:`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,envmap_pars_fragment:`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,envmap_pars_vertex:`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,envmap_physical_pars_fragment:`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,envmap_vertex:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,fog_vertex:`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,fog_pars_vertex:`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,fog_fragment:`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,fog_pars_fragment:`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,gradientmap_pars_fragment:`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,lightmap_pars_fragment:`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,lights_lambert_fragment:`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,lights_lambert_pars_fragment:`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,lights_pars_begin:`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,lights_toon_fragment:`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lights_toon_pars_fragment:`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,lights_phong_fragment:`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,lights_phong_pars_fragment:`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,lights_physical_fragment:`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,lights_physical_pars_fragment:`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
		vec3 iridescenceFresnelDielectric;
		vec3 iridescenceFresnelMetallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
vec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 dfgV = texture2D( dfgLUT, vec2( material.roughness, dotNV ) ).rg;
	vec2 dfgL = texture2D( dfgLUT, vec2( material.roughness, dotNL ) ).rg;
	vec3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;
	vec3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;
	float Ess_V = dfgV.x + dfgV.y;
	float Ess_L = dfgL.x + dfgL.y;
	float Ems_V = 1.0 - Ess_V;
	float Ems_L = 1.0 - Ess_L;
	vec3 Favg = material.specularColorBlended + ( 1.0 - material.specularColorBlended ) * 0.047619;
	vec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg + EPSILON );
	float compensationFactor = Ems_V * Ems_L;
	vec3 multiScatter = Fms * compensationFactor;
	return singleScatter + multiScatter;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnelDielectric, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceFresnelMetallic, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,lights_fragment_begin:`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( material.iridescenceFresnelDielectric, material.iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,lights_fragment_maps:`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,lights_fragment_end:`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,lightprobes_pars_fragment:`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,logdepthbuf_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,logdepthbuf_pars_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_pars_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,map_fragment:`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,map_pars_fragment:`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,map_particle_fragment:`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,map_particle_pars_fragment:`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,metalnessmap_fragment:`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,metalnessmap_pars_fragment:`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,morphinstance_vertex:`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,morphcolor_vertex:`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,morphnormal_vertex:`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,morphtarget_pars_vertex:`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,morphtarget_vertex:`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,normal_fragment_begin:`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,normal_fragment_maps:`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,normal_pars_fragment:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_pars_vertex:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_vertex:`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,normalmap_pars_fragment:`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,clearcoat_normal_fragment_begin:`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,clearcoat_normal_fragment_maps:`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,clearcoat_pars_fragment:`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,iridescence_pars_fragment:`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,opaque_fragment:`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,packing:`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,premultiplied_alpha_fragment:`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,project_vertex:`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,dithering_fragment:`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,dithering_pars_fragment:`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,roughnessmap_fragment:`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,roughnessmap_pars_fragment:`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,shadowmap_pars_fragment:`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,shadowmap_pars_vertex:`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,shadowmap_vertex:`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,shadowmask_pars_fragment:`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,skinbase_vertex:`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,skinning_pars_vertex:`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,skinning_vertex:`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,skinnormal_vertex:`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,specularmap_fragment:`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,specularmap_pars_fragment:`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,tonemapping_fragment:`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,tonemapping_pars_fragment:`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,transmission_fragment:`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,transmission_pars_fragment:`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,uv_pars_fragment:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_pars_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,worldpos_vertex:`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,background_vert:`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,background_frag:`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,backgroundCube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,backgroundCube_frag:`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,cube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,cube_frag:`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,depth_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,depth_frag:`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,distance_vert:`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,distance_frag:`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,equirect_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,equirect_frag:`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,linedashed_vert:`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,linedashed_frag:`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,meshbasic_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,meshbasic_frag:`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshlambert_vert:`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshlambert_frag:`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshmatcap_vert:`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,meshmatcap_frag:`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshnormal_vert:`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,meshnormal_frag:`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,meshphong_vert:`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshphong_frag:`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshphysical_vert:`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,meshphysical_frag:`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshtoon_vert:`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshtoon_frag:`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,points_vert:`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,points_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,shadow_vert:`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,shadow_frag:`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,sprite_vert:`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,sprite_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`},n={common:{diffuse:{value:new i.Q1f(0xffffff)},opacity:{value:1},map:{value:null},mapTransform:{value:new i.dwI},alphaMap:{value:null},alphaMapTransform:{value:new i.dwI},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new i.dwI}},envmap:{envMap:{value:null},envMapRotation:{value:new i.dwI},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new i.dwI}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new i.dwI}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new i.dwI},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new i.dwI},normalScale:{value:new i.I9Y(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new i.dwI},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new i.dwI}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new i.dwI}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new i.dwI}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new i.Q1f(0xffffff)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new i.Pq0},probesMax:{value:new i.Pq0},probesResolution:{value:new i.Pq0}},points:{diffuse:{value:new i.Q1f(0xffffff)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new i.dwI},alphaTest:{value:0},uvTransform:{value:new i.dwI}},sprite:{diffuse:{value:new i.Q1f(0xffffff)},opacity:{value:1},center:{value:new i.I9Y(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new i.dwI},alphaMap:{value:null},alphaMapTransform:{value:new i.dwI},alphaTest:{value:0}}},o={basic:{uniforms:(0,i.Iit)([n.common,n.specularmap,n.envmap,n.aomap,n.lightmap,n.fog]),vertexShader:a.meshbasic_vert,fragmentShader:a.meshbasic_frag},lambert:{uniforms:(0,i.Iit)([n.common,n.specularmap,n.envmap,n.aomap,n.lightmap,n.emissivemap,n.bumpmap,n.normalmap,n.displacementmap,n.fog,n.lights,{emissive:{value:new i.Q1f(0)},envMapIntensity:{value:1}}]),vertexShader:a.meshlambert_vert,fragmentShader:a.meshlambert_frag},phong:{uniforms:(0,i.Iit)([n.common,n.specularmap,n.envmap,n.aomap,n.lightmap,n.emissivemap,n.bumpmap,n.normalmap,n.displacementmap,n.fog,n.lights,{emissive:{value:new i.Q1f(0)},specular:{value:new i.Q1f(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:a.meshphong_vert,fragmentShader:a.meshphong_frag},standard:{uniforms:(0,i.Iit)([n.common,n.envmap,n.aomap,n.lightmap,n.emissivemap,n.bumpmap,n.normalmap,n.displacementmap,n.roughnessmap,n.metalnessmap,n.fog,n.lights,{emissive:{value:new i.Q1f(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:a.meshphysical_vert,fragmentShader:a.meshphysical_frag},toon:{uniforms:(0,i.Iit)([n.common,n.aomap,n.lightmap,n.emissivemap,n.bumpmap,n.normalmap,n.displacementmap,n.gradientmap,n.fog,n.lights,{emissive:{value:new i.Q1f(0)}}]),vertexShader:a.meshtoon_vert,fragmentShader:a.meshtoon_frag},matcap:{uniforms:(0,i.Iit)([n.common,n.bumpmap,n.normalmap,n.displacementmap,n.fog,{matcap:{value:null}}]),vertexShader:a.meshmatcap_vert,fragmentShader:a.meshmatcap_frag},points:{uniforms:(0,i.Iit)([n.points,n.fog]),vertexShader:a.points_vert,fragmentShader:a.points_frag},dashed:{uniforms:(0,i.Iit)([n.common,n.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:a.linedashed_vert,fragmentShader:a.linedashed_frag},depth:{uniforms:(0,i.Iit)([n.common,n.displacementmap]),vertexShader:a.depth_vert,fragmentShader:a.depth_frag},normal:{uniforms:(0,i.Iit)([n.common,n.bumpmap,n.normalmap,n.displacementmap,{opacity:{value:1}}]),vertexShader:a.meshnormal_vert,fragmentShader:a.meshnormal_frag},sprite:{uniforms:(0,i.Iit)([n.sprite,n.fog]),vertexShader:a.sprite_vert,fragmentShader:a.sprite_frag},background:{uniforms:{uvTransform:{value:new i.dwI},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:a.background_vert,fragmentShader:a.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new i.dwI}},vertexShader:a.backgroundCube_vert,fragmentShader:a.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:a.cube_vert,fragmentShader:a.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:a.equirect_vert,fragmentShader:a.equirect_frag},distance:{uniforms:(0,i.Iit)([n.common,n.displacementmap,{referencePosition:{value:new i.Pq0},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:a.distance_vert,fragmentShader:a.distance_frag},shadow:{uniforms:(0,i.Iit)([n.lights,n.fog,{color:{value:new i.Q1f(0)},opacity:{value:1}}]),vertexShader:a.shadow_vert,fragmentShader:a.shadow_frag}};o.physical={uniforms:(0,i.Iit)([o.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new i.dwI},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new i.dwI},clearcoatNormalScale:{value:new i.I9Y(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new i.dwI},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new i.dwI},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new i.dwI},sheen:{value:0},sheenColor:{value:new i.Q1f(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new i.dwI},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new i.dwI},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new i.dwI},transmissionSamplerSize:{value:new i.I9Y},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new i.dwI},attenuationDistance:{value:0},attenuationColor:{value:new i.Q1f(0)},specularColor:{value:new i.Q1f(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new i.dwI},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new i.dwI},anisotropyVector:{value:new i.I9Y},anisotropyMap:{value:null},anisotropyMapTransform:{value:new i.dwI}}]),vertexShader:a.meshphysical_vert,fragmentShader:a.meshphysical_frag};let s={r:0,b:0,g:0},l=new i.kn4,c=new i.dwI;function WebGLBackground(e,t,r,a,n,d){let u,f,p=new i.Q1f(0),m=+(!0!==n),h=null,g=0,_=null;function getBackground(e){let r=!0===e.isScene?e.background:null;if(r&&r.isTexture){let i=e.backgroundBlurriness>0;r=t.get(r,i)}return r}function setClear(t,a){t.getRGB(s,(0,i._Ut)(e)),r.buffers.color.setClear(s.r,s.g,s.b,a,d)}return{getClearColor:function(){return p},setClearColor:function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:1;p.set(e),setClear(p,m=t)},getClearAlpha:function(){return m},setClearAlpha:function(e){setClear(p,m=e)},render:function(t){let i=!1,a=getBackground(t);null===a?setClear(p,m):a&&a.isColor&&(setClear(a,1),i=!0);let n=e.xr.getEnvironmentBlendMode();"additive"===n?r.buffers.color.setClear(0,0,0,1,d):"alpha-blend"===n&&r.buffers.color.setClear(0,0,0,0,d),(e.autoClear||i)&&(r.buffers.depth.setTest(!0),r.buffers.depth.setMask(!0),r.buffers.color.setMask(!0),e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil))},addToRenderList:function(t,r){let n=getBackground(r);n&&(n.isCubeTexture||306===n.mapping)?(void 0===f&&((f=new i.eaF(new i.iNn(1,1,1),new i.BKk({name:"BackgroundCubeMaterial",uniforms:(0,i.lxW)(o.backgroundCube.uniforms),vertexShader:o.backgroundCube.vertexShader,fragmentShader:o.backgroundCube.fragmentShader,side:1,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1}))).geometry.deleteAttribute("normal"),f.geometry.deleteAttribute("uv"),f.onBeforeRender=function(e,t,r){this.matrixWorld.copyPosition(r.matrixWorld)},Object.defineProperty(f.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),a.update(f)),f.material.uniforms.envMap.value=n,f.material.uniforms.backgroundBlurriness.value=r.backgroundBlurriness,f.material.uniforms.backgroundIntensity.value=r.backgroundIntensity,f.material.uniforms.backgroundRotation.value.setFromMatrix4(l.makeRotationFromEuler(r.backgroundRotation)).transpose(),n.isCubeTexture&&!1===n.isRenderTargetTexture&&f.material.uniforms.backgroundRotation.value.premultiply(c),f.material.toneMapped="srgb"!==i.ppV.getTransfer(n.colorSpace),(h!==n||g!==n.version||_!==e.toneMapping)&&(f.material.needsUpdate=!0,h=n,g=n.version,_=e.toneMapping),f.layers.enableAll(),t.unshift(f,f.geometry,f.material,0,0,null)):n&&n.isTexture&&(void 0===u&&((u=new i.eaF(new i.bdM(2,2),new i.BKk({name:"BackgroundMaterial",uniforms:(0,i.lxW)(o.background.uniforms),vertexShader:o.background.vertexShader,fragmentShader:o.background.fragmentShader,side:0,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1}))).geometry.deleteAttribute("normal"),Object.defineProperty(u.material,"map",{get:function(){return this.uniforms.t2D.value}}),a.update(u)),u.material.uniforms.t2D.value=n,u.material.uniforms.backgroundIntensity.value=r.backgroundIntensity,u.material.toneMapped="srgb"!==i.ppV.getTransfer(n.colorSpace),!0===n.matrixAutoUpdate&&n.updateMatrix(),u.material.uniforms.uvTransform.value.copy(n.matrix),(h!==n||g!==n.version||_!==e.toneMapping)&&(u.material.needsUpdate=!0,h=n,g=n.version,_=e.toneMapping),u.layers.enableAll(),t.unshift(u,u.geometry,u.material,0,0,null))},dispose:function(){void 0!==f&&(f.geometry.dispose(),f.material.dispose(),f=void 0),void 0!==u&&(u.geometry.dispose(),u.material.dispose(),u=void 0)}}}function WebGLBindingStates(e,t){let r=e.getParameter(e.MAX_VERTEX_ATTRIBS),i={},a=createBindingState(null),n=a,o=!1;function createVertexArrayObject(){return e.createVertexArray()}function bindVertexArrayObject(t){return e.bindVertexArray(t)}function deleteVertexArrayObject(t){return e.deleteVertexArray(t)}function getBindingState(e,t,r,a){let n=!0===a.wireframe,o=i[t.id];void 0===o&&(o={},i[t.id]=o);let s=!0===e.isInstancedMesh?e.id:0,l=o[s];void 0===l&&(l={},o[s]=l);let c=l[r.id];void 0===c&&(c={},l[r.id]=c);let d=c[n];return void 0===d&&(d=createBindingState(createVertexArrayObject()),c[n]=d),d}function createBindingState(e){let t=[],i=[],a=[];for(let e=0;e<r;e++)t[e]=0,i[e]=0,a[e]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:t,enabledAttributes:i,attributeDivisors:a,object:e,attributes:{},index:null}}function needsUpdate(e,t,r,i){let a=n.attributes,o=t.attributes,s=0,l=r.getAttributes();for(let t in l)if(l[t].location>=0){let r=a[t],i=o[t];if(void 0===i&&("instanceMatrix"===t&&e.instanceMatrix&&(i=e.instanceMatrix),"instanceColor"===t&&e.instanceColor&&(i=e.instanceColor)),void 0===r||r.attribute!==i||i&&r.data!==i.data)return!0;s++}return n.attributesNum!==s||n.index!==i}function saveCache(e,t,r,i){let a={},o=t.attributes,s=0,l=r.getAttributes();for(let t in l)if(l[t].location>=0){let r=o[t];void 0===r&&("instanceMatrix"===t&&e.instanceMatrix&&(r=e.instanceMatrix),"instanceColor"===t&&e.instanceColor&&(r=e.instanceColor));let i={};i.attribute=r,r&&r.data&&(i.data=r.data),a[t]=i,s++}n.attributes=a,n.attributesNum=s,n.index=i}function initAttributes(){let e=n.newAttributes;for(let t=0,r=e.length;t<r;t++)e[t]=0}function enableAttribute(e){enableAttributeAndDivisor(e,0)}function enableAttributeAndDivisor(t,r){let i=n.newAttributes,a=n.enabledAttributes,o=n.attributeDivisors;i[t]=1,0===a[t]&&(e.enableVertexAttribArray(t),a[t]=1),o[t]!==r&&(e.vertexAttribDivisor(t,r),o[t]=r)}function disableUnusedAttributes(){let t=n.newAttributes,r=n.enabledAttributes;for(let i=0,a=r.length;i<a;i++)r[i]!==t[i]&&(e.disableVertexAttribArray(i),r[i]=0)}function vertexAttribPointer(t,r,i,a,n,o,s){!0===s?e.vertexAttribIPointer(t,r,i,n,o):e.vertexAttribPointer(t,r,i,a,n,o)}function setupVertexAttributes(r,i,a,n){initAttributes();let o=n.attributes,s=a.getAttributes(),l=i.defaultAttributeValues;for(let i in s){let a=s[i];if(a.location>=0){let s=o[i];if(void 0===s&&("instanceMatrix"===i&&r.instanceMatrix&&(s=r.instanceMatrix),"instanceColor"===i&&r.instanceColor&&(s=r.instanceColor)),void 0!==s){let i=s.normalized,o=s.itemSize,l=t.get(s);if(void 0===l)continue;let c=l.buffer,d=l.type,u=l.bytesPerElement,f=d===e.INT||d===e.UNSIGNED_INT||1013===s.gpuType;if(s.isInterleavedBufferAttribute){let t=s.data,l=t.stride,p=s.offset;if(t.isInstancedInterleavedBuffer){for(let e=0;e<a.locationSize;e++)enableAttributeAndDivisor(a.location+e,t.meshPerAttribute);!0!==r.isInstancedMesh&&void 0===n._maxInstanceCount&&(n._maxInstanceCount=t.meshPerAttribute*t.count)}else for(let e=0;e<a.locationSize;e++)enableAttribute(a.location+e);e.bindBuffer(e.ARRAY_BUFFER,c);for(let e=0;e<a.locationSize;e++)vertexAttribPointer(a.location+e,o/a.locationSize,d,i,l*u,(p+o/a.locationSize*e)*u,f)}else{if(s.isInstancedBufferAttribute){for(let e=0;e<a.locationSize;e++)enableAttributeAndDivisor(a.location+e,s.meshPerAttribute);!0!==r.isInstancedMesh&&void 0===n._maxInstanceCount&&(n._maxInstanceCount=s.meshPerAttribute*s.count)}else for(let e=0;e<a.locationSize;e++)enableAttribute(a.location+e);e.bindBuffer(e.ARRAY_BUFFER,c);for(let e=0;e<a.locationSize;e++)vertexAttribPointer(a.location+e,o/a.locationSize,d,i,o*u,o/a.locationSize*e*u,f)}}else if(void 0!==l){let t=l[i];if(void 0!==t)switch(t.length){case 2:e.vertexAttrib2fv(a.location,t);break;case 3:e.vertexAttrib3fv(a.location,t);break;case 4:e.vertexAttrib4fv(a.location,t);break;default:e.vertexAttrib1fv(a.location,t)}}}}disableUnusedAttributes()}function dispose(){for(let e in reset(),i){let t=i[e];for(let e in t){let r=t[e];for(let e in r){let t=r[e];for(let e in t)deleteVertexArrayObject(t[e].object),delete t[e];delete r[e]}}delete i[e]}}function reset(){resetDefaultState(),o=!0,n!==a&&bindVertexArrayObject((n=a).object)}function resetDefaultState(){a.geometry=null,a.program=null,a.wireframe=!1}return{setup:function(r,i,a,s,l){let c=!1,d=getBindingState(r,s,a,i);n!==d&&bindVertexArrayObject((n=d).object),(c=needsUpdate(r,s,a,l))&&saveCache(r,s,a,l),null!==l&&t.update(l,e.ELEMENT_ARRAY_BUFFER),(c||o)&&(o=!1,setupVertexAttributes(r,i,a,s),null!==l&&e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,t.get(l).buffer))},reset:reset,resetDefaultState:resetDefaultState,dispose:dispose,releaseStatesOfGeometry:function(e){if(void 0===i[e.id])return;let t=i[e.id];for(let e in t){let r=t[e];for(let e in r){let t=r[e];for(let e in t)deleteVertexArrayObject(t[e].object),delete t[e];delete r[e]}}delete i[e.id]},releaseStatesOfObject:function(e){for(let t in i){let r=i[t],a=!0===e.isInstancedMesh?e.id:0,n=r[a];if(void 0!==n){for(let e in n){let t=n[e];for(let e in t)deleteVertexArrayObject(t[e].object),delete t[e];delete n[e]}delete r[a],0===Object.keys(r).length&&delete i[t]}}},releaseStatesOfProgram:function(e){for(let t in i){let r=i[t];for(let t in r){let i=r[t];if(void 0===i[e.id])continue;let a=i[e.id];for(let e in a)deleteVertexArrayObject(a[e].object),delete a[e];delete i[e.id]}}},initAttributes:initAttributes,enableAttribute:enableAttribute,disableUnusedAttributes:disableUnusedAttributes}}function WebGLBufferRenderer(e,t,r){let i;function setMode(e){i=e}function render(t,a){e.drawArrays(i,t,a),r.update(a,i,1)}function renderInstances(t,a,n){0!==n&&(e.drawArraysInstanced(i,t,a,n),r.update(a,i,n))}function renderMultiDraw(e,a,n){if(0===n)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,e,0,a,0,n);let o=0;for(let e=0;e<n;e++)o+=a[e];r.update(o,i,1)}this.setMode=setMode,this.render=render,this.renderInstances=renderInstances,this.renderMultiDraw=renderMultiDraw}function WebGLCapabilities(e,t,r,a){let n;function getMaxAnisotropy(){if(void 0!==n)return n;if(!0===t.has("EXT_texture_filter_anisotropic")){let r=t.get("EXT_texture_filter_anisotropic");n=e.getParameter(r.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else n=0;return n}function textureFormatReadable(t){return 1023===t||a.convert(t)===e.getParameter(e.IMPLEMENTATION_COLOR_READ_FORMAT)}function textureTypeReadable(r){let i=1016===r&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return 1009===r||a.convert(r)===e.getParameter(e.IMPLEMENTATION_COLOR_READ_TYPE)||1015===r||!!i}function getMaxPrecision(t){if("highp"===t){if(e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.HIGH_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.HIGH_FLOAT).precision>0)return"highp";t="mediump"}return"mediump"===t&&e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.MEDIUM_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let o=void 0!==r.precision?r.precision:"highp",s=getMaxPrecision(o);s!==o&&((0,i.R8M)("WebGLRenderer:",o,"not supported, using",s,"instead."),o=s);let l=!0===r.logarithmicDepthBuffer,c=!0===r.reversedDepthBuffer&&t.has("EXT_clip_control");return!0===r.reversedDepthBuffer&&!1===c&&(0,i.R8M)("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer."),{isWebGL2:!0,getMaxAnisotropy:getMaxAnisotropy,getMaxPrecision:getMaxPrecision,textureFormatReadable:textureFormatReadable,textureTypeReadable:textureTypeReadable,precision:o,logarithmicDepthBuffer:l,reversedDepthBuffer:c,maxTextures:e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS),maxVertexTextures:e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS),maxTextureSize:e.getParameter(e.MAX_TEXTURE_SIZE),maxCubemapSize:e.getParameter(e.MAX_CUBE_MAP_TEXTURE_SIZE),maxAttributes:e.getParameter(e.MAX_VERTEX_ATTRIBS),maxVertexUniforms:e.getParameter(e.MAX_VERTEX_UNIFORM_VECTORS),maxVaryings:e.getParameter(e.MAX_VARYING_VECTORS),maxFragmentUniforms:e.getParameter(e.MAX_FRAGMENT_UNIFORM_VECTORS),maxSamples:e.getParameter(e.MAX_SAMPLES),samples:e.getParameter(e.SAMPLES)}}function WebGLClipping(e){let t=this,r=null,a=0,n=!1,o=!1,s=new i.Zcv,l=new i.dwI,c={value:null,needsUpdate:!1};function resetGlobalState(){c.value!==r&&(c.value=r,c.needsUpdate=a>0),t.numPlanes=a,t.numIntersection=0}function projectPlanes(e,r,i,a){let n=null!==e?e.length:0,o=null;if(0!==n){if(o=c.value,!0!==a||null===o){let t=i+4*n,a=r.matrixWorldInverse;l.getNormalMatrix(a),(null===o||o.length<t)&&(o=new Float32Array(t));for(let t=0,r=i;t!==n;++t,r+=4)s.copy(e[t]).applyMatrix4(a,l),s.normal.toArray(o,r),o[r+3]=s.constant}c.value=o,c.needsUpdate=!0}return t.numPlanes=n,t.numIntersection=0,o}this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(e,t){let r=0!==e.length||t||0!==a||n;return n=t,a=e.length,r},this.beginShadows=function(){o=!0,projectPlanes(null)},this.endShadows=function(){o=!1},this.setGlobalState=function(e,t){r=projectPlanes(e,t,0)},this.setState=function(t,i,s){let l=t.clippingPlanes,d=t.clipIntersection,u=t.clipShadows,f=e.get(t);if(n&&null!==l&&0!==l.length&&(!o||u)){let e=o?0:a,t=4*e,n=f.clippingState||null;c.value=n,n=projectPlanes(l,i,t,s);for(let e=0;e!==t;++e)n[e]=r[e];f.clippingState=n,this.numIntersection=d?this.numPlanes:0,this.numPlanes+=e}else o?projectPlanes(null):resetGlobalState()}}c.set(-1,0,0,0,1,0,0,0,1);let d=[.125,.215,.35,.446,.526,.582],u=new i.qUd,f=new i.Q1f,p=null,m=0,h=0,g=!1,_=new i.Pq0;let PMREMGenerator=class PMREMGenerator{fromScene(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0,r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:.1,i=arguments.length>3&&void 0!==arguments[3]?arguments[3]:100,a=arguments.length>4&&void 0!==arguments[4]?arguments[4]:{},{size:n=256,position:o=_}=a;p=this._renderer.getRenderTarget(),m=this._renderer.getActiveCubeFace(),h=this._renderer.getActiveMipmapLevel(),g=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(n);let s=this._allocateTargets();return s.depthBuffer=!0,this._sceneToCubeUV(e,r,i,s,o),t>0&&this._blur(s,0,0,t),this._applyPMREM(s),this._cleanup(s),s}fromEquirectangular(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:null;return this._fromTexture(e,t)}fromCubemap(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:null;return this._fromTexture(e,t)}compileCubemapShader(){null===this._cubemapMaterial&&(this._cubemapMaterial=_getCubemapMaterial(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){null===this._equirectMaterial&&(this._equirectMaterial=_getEquirectMaterial(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),null!==this._cubemapMaterial&&this._cubemapMaterial.dispose(),null!==this._equirectMaterial&&this._equirectMaterial.dispose(),null!==this._backgroundBox&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){null!==this._blurMaterial&&this._blurMaterial.dispose(),null!==this._ggxMaterial&&this._ggxMaterial.dispose(),null!==this._pingPongRenderTarget&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(p,m,h),this._renderer.xr.enabled=g,e.scissorTest=!1,_setViewport(e,0,0,e.width,e.height)}_fromTexture(e,t){301===e.mapping||302===e.mapping?this._setSize(0===e.image.length?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),p=this._renderer.getRenderTarget(),m=this._renderer.getActiveCubeFace(),h=this._renderer.getActiveMipmapLevel(),g=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let r=t||this._allocateTargets();return this._textureToCubeUV(e,r),this._applyPMREM(r),this._cleanup(r),r}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,r={magFilter:1006,minFilter:1006,generateMipmaps:!1,type:1016,format:1023,colorSpace:i.Zr2,depthBuffer:!1},a=_createRenderTarget(e,t,r);if(null===this._pingPongRenderTarget||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){null!==this._pingPongRenderTarget&&this._dispose(),this._pingPongRenderTarget=_createRenderTarget(e,t,r);let{_lodMax:i}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=_createPlanes(i)),this._blurMaterial=_getBlurShader(i,e,t),this._ggxMaterial=_getGGXShader(i,e,t)}return a}_compileMaterial(e){let t=new i.eaF(new i.LoY,e);this._renderer.compile(t,u)}_sceneToCubeUV(e,t,r,a,n){let o=new i.ubm(90,1,t,r),s=[1,-1,1,1,1,1],l=[1,1,1,-1,-1,-1],c=this._renderer,d=c.autoClear,u=c.toneMapping;c.getClearColor(f),c.toneMapping=0,c.autoClear=!1,c.state.buffers.depth.getReversed()&&(c.setRenderTarget(a),c.clearDepth(),c.setRenderTarget(null)),null===this._backgroundBox&&(this._backgroundBox=new i.eaF(new i.iNn,new i.V9B({name:"PMREM.Background",side:1,depthWrite:!1,depthTest:!1})));let p=this._backgroundBox,m=p.material,h=!1,g=e.background;g?g.isColor&&(m.color.copy(g),e.background=null,h=!0):(m.color.copy(f),h=!0);for(let t=0;t<6;t++){let r=t%3;0===r?(o.up.set(0,s[t],0),o.position.set(n.x,n.y,n.z),o.lookAt(n.x+l[t],n.y,n.z)):1===r?(o.up.set(0,0,s[t]),o.position.set(n.x,n.y,n.z),o.lookAt(n.x,n.y+l[t],n.z)):(o.up.set(0,s[t],0),o.position.set(n.x,n.y,n.z),o.lookAt(n.x,n.y,n.z+l[t]));let i=this._cubeSize;_setViewport(a,r*i,t>2?i:0,i,i),c.setRenderTarget(a),h&&c.render(p,o),c.render(e,o)}c.toneMapping=u,c.autoClear=d,e.background=g}_textureToCubeUV(e,t){let r=this._renderer,i=301===e.mapping||302===e.mapping;i?(null===this._cubemapMaterial&&(this._cubemapMaterial=_getCubemapMaterial()),this._cubemapMaterial.uniforms.flipEnvMap.value=!1===e.isRenderTargetTexture?-1:1):null===this._equirectMaterial&&(this._equirectMaterial=_getEquirectMaterial());let a=i?this._cubemapMaterial:this._equirectMaterial,n=this._lodMeshes[0];n.material=a,a.uniforms.envMap.value=e;let o=this._cubeSize;_setViewport(t,0,0,3*o,2*o),r.setRenderTarget(t),r.render(n,u)}_applyPMREM(e){let t=this._renderer,r=t.autoClear;t.autoClear=!1;let i=this._lodMeshes.length;for(let t=1;t<i;t++)this._applyGGXFilter(e,t-1,t);t.autoClear=r}_applyGGXFilter(e,t,r){let i=this._renderer,a=this._pingPongRenderTarget,n=this._ggxMaterial,o=this._lodMeshes[r];o.material=n;let s=n.uniforms,l=r/(this._lodMeshes.length-1),c=t/(this._lodMeshes.length-1),d=Math.sqrt(l*l-c*c),{_lodMax:f}=this,p=this._sizeLods[r],m=3*p*(r>f-4?r-f+4:0),h=4*(this._cubeSize-p);s.envMap.value=e.texture,s.roughness.value=d*(0+1.25*l),s.mipInt.value=f-t,_setViewport(a,m,h,3*p,2*p),i.setRenderTarget(a),i.render(o,u),s.envMap.value=a.texture,s.roughness.value=0,s.mipInt.value=f-r,_setViewport(e,m,h,3*p,2*p),i.setRenderTarget(e),i.render(o,u)}_blur(e,t,r,i,a){let n=this._pingPongRenderTarget;this._halfBlur(e,n,t,r,i,"latitudinal",a),this._halfBlur(n,e,r,r,i,"longitudinal",a)}_halfBlur(e,t,r,a,n,o,s){let l=this._renderer,c=this._blurMaterial;"latitudinal"!==o&&"longitudinal"!==o&&(0,i.z3S)("blur direction must be either latitudinal or longitudinal!");let d=this._lodMeshes[a];d.material=c;let f=c.uniforms,p=this._sizeLods[r]-1,m=isFinite(n)?Math.PI/(2*p):2*Math.PI/39,h=n/m,g=isFinite(n)?1+Math.floor(3*h):20;g>20&&(0,i.R8M)("sigmaRadians, ".concat(n,", is too large and will clip, as it requested ").concat(g," samples when the maximum is set to ").concat(20));let _=[],v=0;for(let e=0;e<20;++e){let t=e/h,r=Math.exp(-t*t/2);_.push(r),0===e?v+=r:e<g&&(v+=2*r)}for(let e=0;e<_.length;e++)_[e]=_[e]/v;f.envMap.value=e.texture,f.samples.value=g,f.weights.value=_,f.latitudinal.value="latitudinal"===o,s&&(f.poleAxis.value=s);let{_lodMax:E}=this;f.dTheta.value=m,f.mipInt.value=E-r;let S=this._sizeLods[a],T=4*(this._cubeSize-S);_setViewport(t,3*S*(a>E-4?a-E+4:0),T,3*S,2*S),l.setRenderTarget(t),l.render(d,u)}constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}};function _createPlanes(e){let t=[],r=[],a=[],n=e,o=e-4+1+d.length;for(let s=0;s<o;s++){let o=Math.pow(2,n);t.push(o);let l=1/o;s>e-4?l=d[s-e+4-1]:0===s&&(l=0),r.push(l);let c=1/(o-2),u=-c,f=1+c,p=[u,u,f,u,f,f,u,u,f,f,u,f],m=new Float32Array(108),h=new Float32Array(72),g=new Float32Array(36);for(let e=0;e<6;e++){let t=e%3*2/3-1,r=e>2?0:-1,i=[t,r,0,t+2/3,r,0,t+2/3,r+1,0,t,r,0,t+2/3,r+1,0,t,r+1,0];m.set(i,18*e),h.set(p,12*e);let a=[e,e,e,e,e,e];g.set(a,6*e)}let _=new i.LoY;_.setAttribute("position",new i.THS(m,3)),_.setAttribute("uv",new i.THS(h,2)),_.setAttribute("faceIndex",new i.THS(g,1)),a.push(new i.eaF(_,null)),n>4&&n--}return{lodMeshes:a,sizeLods:t,sigmas:r}}function _createRenderTarget(e,t,r){let a=new i.nWS(e,t,r);return a.texture.mapping=306,a.texture.name="PMREM.cubeUv",a.scissorTest=!0,a}function _setViewport(e,t,r,i,a){e.viewport.set(t,r,i,a),e.scissor.set(t,r,i,a)}function _getGGXShader(e,t,r){return new i.BKk({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:256,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/r,CUBEUV_MAX_MIP:"".concat(e,".0")},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:_getCommonVertexShader(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function _getBlurShader(e,t,r){let a=new Float32Array(20),n=new i.Pq0(0,1,0);return new i.BKk({name:"SphericalGaussianBlur",defines:{n:20,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/r,CUBEUV_MAX_MIP:"".concat(e,".0")},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:a},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:n}},vertexShader:_getCommonVertexShader(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function _getEquirectMaterial(){return new i.BKk({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:_getCommonVertexShader(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function _getCubemapMaterial(){return new i.BKk({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:_getCommonVertexShader(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function _getCommonVertexShader(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}let WebGLCubeRenderTarget=class WebGLCubeRenderTarget extends i.nWS{fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let r={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},a=new i.iNn(5,5,5),n=new i.BKk({name:"CubemapFromEquirect",uniforms:(0,i.lxW)(r.uniforms),vertexShader:r.vertexShader,fragmentShader:r.fragmentShader,side:1,blending:0});n.uniforms.tEquirect.value=t;let o=new i.eaF(a,n),s=t.minFilter;return 1008===t.minFilter&&(t.minFilter=1006),new i.F1T(1,10,this).update(e,o),t.minFilter=s,o.geometry.dispose(),o.material.dispose(),this}clear(e){let t=!(arguments.length>1)||void 0===arguments[1]||arguments[1],r=!(arguments.length>2)||void 0===arguments[2]||arguments[2],i=!(arguments.length>3)||void 0===arguments[3]||arguments[3],a=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,r,i);e.setRenderTarget(a)}constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const r={width:e,height:e,depth:1};this.texture=new i.b4q([r,r,r,r,r,r]),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}};function WebGLEnvironments(e){let t=new WeakMap,r=new WeakMap,i=null;function getCube(r){if(r&&r.isTexture){let i=r.mapping;if(303===i||304===i)if(t.has(r))return mapTextureMapping(t.get(r).texture,r.mapping);else{let i=r.image;if(!i||!(i.height>0))return null;{let a=new WebGLCubeRenderTarget(i.height);return a.fromEquirectangularTexture(e,r),t.set(r,a),r.addEventListener("dispose",onCubemapDispose),mapTextureMapping(a.texture,r.mapping)}}}return r}function getPMREM(t){if(t&&t.isTexture){let a=t.mapping,n=303===a||304===a,o=301===a||302===a;if(n||o){let a=r.get(t),s=void 0!==a?a.texture.pmremVersion:0;if(t.isRenderTargetTexture&&t.pmremVersion!==s)return null===i&&(i=new PMREMGenerator(e)),(a=n?i.fromEquirectangular(t,a):i.fromCubemap(t,a)).texture.pmremVersion=t.pmremVersion,r.set(t,a),a.texture;{if(void 0!==a)return a.texture;let s=t.image;return n&&s&&s.height>0||o&&s&&isCubeTextureComplete(s)?(null===i&&(i=new PMREMGenerator(e)),(a=n?i.fromEquirectangular(t):i.fromCubemap(t)).texture.pmremVersion=t.pmremVersion,r.set(t,a),t.addEventListener("dispose",onPMREMDispose),a.texture):null}}}return t}function mapTextureMapping(e,t){return 303===t?e.mapping=301:304===t&&(e.mapping=302),e}function isCubeTextureComplete(e){let t=0;for(let r=0;r<6;r++)void 0!==e[r]&&t++;return 6===t}function onCubemapDispose(e){let r=e.target;r.removeEventListener("dispose",onCubemapDispose);let i=t.get(r);void 0!==i&&(t.delete(r),i.dispose())}function onPMREMDispose(e){let t=e.target;t.removeEventListener("dispose",onPMREMDispose);let i=r.get(t);void 0!==i&&(r.delete(t),i.dispose())}return{get:function(e){let t=arguments.length>1&&void 0!==arguments[1]&&arguments[1];return null==e?null:t?getPMREM(e):getCube(e)},dispose:function(){t=new WeakMap,r=new WeakMap,null!==i&&(i.dispose(),i=null)}}}function WebGLExtensions(e){let t={};function getExtension(r){if(void 0!==t[r])return t[r];let i=e.getExtension(r);return t[r]=i,i}return{has:function(e){return null!==getExtension(e)},init:function(){getExtension("EXT_color_buffer_float"),getExtension("WEBGL_clip_cull_distance"),getExtension("OES_texture_float_linear"),getExtension("EXT_color_buffer_half_float"),getExtension("WEBGL_multisampled_render_to_texture"),getExtension("WEBGL_render_shared_exponent")},get:function(e){let t=getExtension(e);return null===t&&(0,i.mcG)("WebGLRenderer: "+e+" extension not supported."),t}}}function WebGLGeometries(e,t,r,a){let n={},o=new WeakMap;function onGeometryDispose(e){let i=e.target;for(let e in null!==i.index&&t.remove(i.index),i.attributes)t.remove(i.attributes[e]);i.removeEventListener("dispose",onGeometryDispose),delete n[i.id];let s=o.get(i);s&&(t.remove(s),o.delete(i)),a.releaseStatesOfGeometry(i),!0===i.isInstancedBufferGeometry&&delete i._maxInstanceCount,r.memory.geometries--}function updateWireframeAttribute(e){let r=[],a=e.index,n=e.attributes.position,s=0;if(void 0===n)return;if(null!==a){let e=a.array;s=a.version;for(let t=0,i=e.length;t<i;t+=3){let i=e[t+0],a=e[t+1],n=e[t+2];r.push(i,a,a,n,n,i)}}else{let e=n.array;s=n.version;for(let t=0,i=e.length/3-1;t<i;t+=3){let e=t+0,i=t+1,a=t+2;r.push(e,i,i,a,a,e)}}let l=new(n.count>=65535?i.MW4:i.A$4)(r,1);l.version=s;let c=o.get(e);c&&t.remove(c),o.set(e,l)}return{get:function(e,t){return!0===n[t.id]||(t.addEventListener("dispose",onGeometryDispose),n[t.id]=!0,r.memory.geometries++),t},update:function(r){let i=r.attributes;for(let r in i)t.update(i[r],e.ARRAY_BUFFER)},getWireframeAttribute:function(e){let t=o.get(e);if(t){let r=e.index;null!==r&&t.version<r.version&&updateWireframeAttribute(e)}else updateWireframeAttribute(e);return o.get(e)}}}function WebGLIndexedBufferRenderer(e,t,r){let i,a,n;function setMode(e){i=e}function setIndex(e){a=e.type,n=e.bytesPerElement}function render(t,o){e.drawElements(i,o,a,t*n),r.update(o,i,1)}function renderInstances(t,o,s){0!==s&&(e.drawElementsInstanced(i,o,a,t*n,s),r.update(o,i,s))}function renderMultiDraw(e,n,o){if(0===o)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,n,0,a,e,0,o);let s=0;for(let e=0;e<o;e++)s+=n[e];r.update(s,i,1)}this.setMode=setMode,this.setIndex=setIndex,this.render=render,this.renderInstances=renderInstances,this.renderMultiDraw=renderMultiDraw}function WebGLInfo(e){let t={frame:0,calls:0,triangles:0,points:0,lines:0};function update(r,a,n){switch(t.calls++,a){case e.TRIANGLES:t.triangles+=r/3*n;break;case e.LINES:t.lines+=r/2*n;break;case e.LINE_STRIP:t.lines+=n*(r-1);break;case e.LINE_LOOP:t.lines+=n*r;break;case e.POINTS:t.points+=n*r;break;default:(0,i.z3S)("WebGLInfo: Unknown draw mode:",a)}}function reset(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:{geometries:0,textures:0},render:t,programs:null,autoReset:!0,reset:reset,update:update}}function WebGLMorphtargets(e,t,r){let a=new WeakMap,n=new i.IUQ;return{update:function(o,s,l){let c=o.morphTargetInfluences,d=s.morphAttributes.position||s.morphAttributes.normal||s.morphAttributes.color,u=void 0!==d?d.length:0,f=a.get(s);if(void 0===f||f.count!==u){void 0!==f&&f.texture.dispose();let e=void 0!==s.morphAttributes.position,r=void 0!==s.morphAttributes.normal,o=void 0!==s.morphAttributes.color,l=s.morphAttributes.position||[],c=s.morphAttributes.normal||[],d=s.morphAttributes.color||[],p=0;!0===e&&(p=1),!0===r&&(p=2),!0===o&&(p=3);let m=s.attributes.position.count*p,h=1;m>t.maxTextureSize&&(h=Math.ceil(m/t.maxTextureSize),m=t.maxTextureSize);let g=new Float32Array(m*h*4*u),_=new i.rFo(g,m,h,u);_.type=1015,_.needsUpdate=!0;let v=4*p;for(let t=0;t<u;t++){let i=l[t],a=c[t],s=d[t],u=m*h*4*t;for(let t=0;t<i.count;t++){let l=t*v;!0===e&&(n.fromBufferAttribute(i,t),g[u+l+0]=n.x,g[u+l+1]=n.y,g[u+l+2]=n.z,g[u+l+3]=0),!0===r&&(n.fromBufferAttribute(a,t),g[u+l+4]=n.x,g[u+l+5]=n.y,g[u+l+6]=n.z,g[u+l+7]=0),!0===o&&(n.fromBufferAttribute(s,t),g[u+l+8]=n.x,g[u+l+9]=n.y,g[u+l+10]=n.z,g[u+l+11]=4===s.itemSize?n.w:1)}}function disposeTexture(){_.dispose(),a.delete(s),s.removeEventListener("dispose",disposeTexture)}f={count:u,texture:_,size:new i.I9Y(m,h)},a.set(s,f),s.addEventListener("dispose",disposeTexture)}if(!0===o.isInstancedMesh&&null!==o.morphTexture)l.getUniforms().setValue(e,"morphTexture",o.morphTexture,r);else{let t=0;for(let e=0;e<c.length;e++)t+=c[e];let r=s.morphTargetsRelative?1:1-t;l.getUniforms().setValue(e,"morphTargetBaseInfluence",r),l.getUniforms().setValue(e,"morphTargetInfluences",c)}l.getUniforms().setValue(e,"morphTargetsTexture",f.texture,r),l.getUniforms().setValue(e,"morphTargetsTextureSize",f.size)}}}function WebGLObjects(e,t,r,i,a){let n=new WeakMap;function onInstancedMeshDispose(e){let t=e.target;t.removeEventListener("dispose",onInstancedMeshDispose),i.releaseStatesOfObject(t),r.remove(t.instanceMatrix),null!==t.instanceColor&&r.remove(t.instanceColor)}return{update:function(i){let o=a.render.frame,s=i.geometry,l=t.get(i,s);if(n.get(l)!==o&&(t.update(l),n.set(l,o)),i.isInstancedMesh&&(!1===i.hasEventListener("dispose",onInstancedMeshDispose)&&i.addEventListener("dispose",onInstancedMeshDispose),n.get(i)!==o&&(r.update(i.instanceMatrix,e.ARRAY_BUFFER),null!==i.instanceColor&&r.update(i.instanceColor,e.ARRAY_BUFFER),n.set(i,o))),i.isSkinnedMesh){let e=i.skeleton;n.get(e)!==o&&(e.update(),n.set(e,o))}return l},dispose:function(){n=new WeakMap}}}let v={1:"LINEAR_TONE_MAPPING",2:"REINHARD_TONE_MAPPING",3:"CINEON_TONE_MAPPING",4:"ACES_FILMIC_TONE_MAPPING",6:"AGX_TONE_MAPPING",7:"NEUTRAL_TONE_MAPPING",5:"CUSTOM_TONE_MAPPING"};function WebGLOutput(e,t,r,a,n,o){let s,l=new i.nWS(t,r,{type:e,depthBuffer:n,stencilBuffer:o,samples:4*!!a,depthTexture:n?new i.VCu(t,r):void 0}),c=new i.nWS(t,r,{type:1016,depthBuffer:!1,stencilBuffer:!1}),d=new i.LoY;d.setAttribute("position",new i.qtW([-1,3,0,-1,-1,0,3,-1,0],3)),d.setAttribute("uv",new i.qtW([0,2,0,0,2,0],2));let u=new i.D$Q({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),f=new i.eaF(d,u),p=new i.qUd(-1,1,1,-1,0,1),m=null,h=null,g=!1,_=null,E=[],S=!1;this.setSize=function(e,t){l.setSize(e,t),c.setSize(e,t);for(let r=0;r<E.length;r++){let i=E[r];i.setSize&&i.setSize(e,t)}},this.setEffects=function(e){S=(E=e).length>0&&!0===E[0].isRenderPass;let t=l.width,r=l.height;for(let e=0;e<E.length;e++){let i=E[e];i.setSize&&i.setSize(t,r)}},this.begin=function(e,t){if(g||0===e.toneMapping&&0===E.length)return!1;if(_=t,null!==t){let e=t.width,r=t.height;(l.width!==e||l.height!==r)&&this.setSize(e,r)}return!1===S&&e.setRenderTarget(l),s=e.toneMapping,e.toneMapping=0,!0},this.hasRenderPass=function(){return S},this.end=function(e,t){e.toneMapping=s,g=!0;let r=l,a=c;for(let i=0;i<E.length;i++){let n=E[i];if(!1!==n.enabled&&(n.render(e,a,r,t),!1!==n.needsSwap)){let e=r;r=a,a=e}}if(m!==e.outputColorSpace||h!==e.toneMapping){m=e.outputColorSpace,h=e.toneMapping,u.defines={},"srgb"===i.ppV.getTransfer(m)&&(u.defines.SRGB_TRANSFER="");let t=v[h];t&&(u.defines[t]=""),u.needsUpdate=!0}u.uniforms.tDiffuse.value=r.texture,e.setRenderTarget(_),e.render(f,p),_=null,g=!1},this.isCompositing=function(){return g},this.dispose=function(){l.depthTexture&&l.depthTexture.dispose(),l.dispose(),c.dispose(),d.dispose(),u.dispose()}}let E=new i.gPd,S=new i.VCu(1,1),T=new i.rFo,M=new i.dYF,x=new i.b4q,R=[],b=[],A=new Float32Array(16),C=new Float32Array(9),P=new Float32Array(4);function flatten(e,t,r){let i=e[0];if(i<=0||i>0)return e;let a=t*r,n=R[a];if(void 0===n&&(n=new Float32Array(a),R[a]=n),0!==t){i.toArray(n,0);for(let i=1,a=0;i!==t;++i)a+=r,e[i].toArray(n,a)}return n}function arraysEqual(e,t){if(e.length!==t.length)return!1;for(let r=0,i=e.length;r<i;r++)if(e[r]!==t[r])return!1;return!0}function copyArray(e,t){for(let r=0,i=t.length;r<i;r++)e[r]=t[r]}function allocTexUnits(e,t){let r=b[t];void 0===r&&(r=new Int32Array(t),b[t]=r);for(let i=0;i!==t;++i)r[i]=e.allocateTextureUnit();return r}function setValueV1f(e,t){let r=this.cache;r[0]!==t&&(e.uniform1f(this.addr,t),r[0]=t)}function setValueV2f(e,t){let r=this.cache;if(void 0!==t.x)(r[0]!==t.x||r[1]!==t.y)&&(e.uniform2f(this.addr,t.x,t.y),r[0]=t.x,r[1]=t.y);else{if(arraysEqual(r,t))return;e.uniform2fv(this.addr,t),copyArray(r,t)}}function setValueV3f(e,t){let r=this.cache;if(void 0!==t.x)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z)&&(e.uniform3f(this.addr,t.x,t.y,t.z),r[0]=t.x,r[1]=t.y,r[2]=t.z);else if(void 0!==t.r)(r[0]!==t.r||r[1]!==t.g||r[2]!==t.b)&&(e.uniform3f(this.addr,t.r,t.g,t.b),r[0]=t.r,r[1]=t.g,r[2]=t.b);else{if(arraysEqual(r,t))return;e.uniform3fv(this.addr,t),copyArray(r,t)}}function setValueV4f(e,t){let r=this.cache;if(void 0!==t.x)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z||r[3]!==t.w)&&(e.uniform4f(this.addr,t.x,t.y,t.z,t.w),r[0]=t.x,r[1]=t.y,r[2]=t.z,r[3]=t.w);else{if(arraysEqual(r,t))return;e.uniform4fv(this.addr,t),copyArray(r,t)}}function setValueM2(e,t){let r=this.cache,i=t.elements;if(void 0===i){if(arraysEqual(r,t))return;e.uniformMatrix2fv(this.addr,!1,t),copyArray(r,t)}else{if(arraysEqual(r,i))return;P.set(i),e.uniformMatrix2fv(this.addr,!1,P),copyArray(r,i)}}function setValueM3(e,t){let r=this.cache,i=t.elements;if(void 0===i){if(arraysEqual(r,t))return;e.uniformMatrix3fv(this.addr,!1,t),copyArray(r,t)}else{if(arraysEqual(r,i))return;C.set(i),e.uniformMatrix3fv(this.addr,!1,C),copyArray(r,i)}}function setValueM4(e,t){let r=this.cache,i=t.elements;if(void 0===i){if(arraysEqual(r,t))return;e.uniformMatrix4fv(this.addr,!1,t),copyArray(r,t)}else{if(arraysEqual(r,i))return;A.set(i),e.uniformMatrix4fv(this.addr,!1,A),copyArray(r,i)}}function setValueV1i(e,t){let r=this.cache;r[0]!==t&&(e.uniform1i(this.addr,t),r[0]=t)}function setValueV2i(e,t){let r=this.cache;if(void 0!==t.x)(r[0]!==t.x||r[1]!==t.y)&&(e.uniform2i(this.addr,t.x,t.y),r[0]=t.x,r[1]=t.y);else{if(arraysEqual(r,t))return;e.uniform2iv(this.addr,t),copyArray(r,t)}}function setValueV3i(e,t){let r=this.cache;if(void 0!==t.x)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z)&&(e.uniform3i(this.addr,t.x,t.y,t.z),r[0]=t.x,r[1]=t.y,r[2]=t.z);else{if(arraysEqual(r,t))return;e.uniform3iv(this.addr,t),copyArray(r,t)}}function setValueV4i(e,t){let r=this.cache;if(void 0!==t.x)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z||r[3]!==t.w)&&(e.uniform4i(this.addr,t.x,t.y,t.z,t.w),r[0]=t.x,r[1]=t.y,r[2]=t.z,r[3]=t.w);else{if(arraysEqual(r,t))return;e.uniform4iv(this.addr,t),copyArray(r,t)}}function setValueV1ui(e,t){let r=this.cache;r[0]!==t&&(e.uniform1ui(this.addr,t),r[0]=t)}function setValueV2ui(e,t){let r=this.cache;if(void 0!==t.x)(r[0]!==t.x||r[1]!==t.y)&&(e.uniform2ui(this.addr,t.x,t.y),r[0]=t.x,r[1]=t.y);else{if(arraysEqual(r,t))return;e.uniform2uiv(this.addr,t),copyArray(r,t)}}function setValueV3ui(e,t){let r=this.cache;if(void 0!==t.x)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z)&&(e.uniform3ui(this.addr,t.x,t.y,t.z),r[0]=t.x,r[1]=t.y,r[2]=t.z);else{if(arraysEqual(r,t))return;e.uniform3uiv(this.addr,t),copyArray(r,t)}}function setValueV4ui(e,t){let r=this.cache;if(void 0!==t.x)(r[0]!==t.x||r[1]!==t.y||r[2]!==t.z||r[3]!==t.w)&&(e.uniform4ui(this.addr,t.x,t.y,t.z,t.w),r[0]=t.x,r[1]=t.y,r[2]=t.z,r[3]=t.w);else{if(arraysEqual(r,t))return;e.uniform4uiv(this.addr,t),copyArray(r,t)}}function setValueT1(e,t,r){let i,a=this.cache,n=r.allocateTextureUnit();a[0]!==n&&(e.uniform1i(this.addr,n),a[0]=n),this.type===e.SAMPLER_2D_SHADOW?(S.compareFunction=r.isReversedDepthBuffer()?518:515,i=S):i=E,r.setTexture2D(t||i,n)}function setValueT3D1(e,t,r){let i=this.cache,a=r.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a),r.setTexture3D(t||M,a)}function setValueT6(e,t,r){let i=this.cache,a=r.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a),r.setTextureCube(t||x,a)}function setValueT2DArray1(e,t,r){let i=this.cache,a=r.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a),r.setTexture2DArray(t||T,a)}function getSingularSetter(e){switch(e){case 5126:return setValueV1f;case 35664:return setValueV2f;case 35665:return setValueV3f;case 35666:return setValueV4f;case 35674:return setValueM2;case 35675:return setValueM3;case 35676:return setValueM4;case 5124:case 35670:return setValueV1i;case 35667:case 35671:return setValueV2i;case 35668:case 35672:return setValueV3i;case 35669:case 35673:return setValueV4i;case 5125:return setValueV1ui;case 36294:return setValueV2ui;case 36295:return setValueV3ui;case 36296:return setValueV4ui;case 35678:case 36198:case 36298:case 36306:case 35682:return setValueT1;case 35679:case 36299:case 36307:return setValueT3D1;case 35680:case 36300:case 36308:case 36293:return setValueT6;case 36289:case 36303:case 36311:case 36292:return setValueT2DArray1}}function setValueV1fArray(e,t){e.uniform1fv(this.addr,t)}function setValueV2fArray(e,t){let r=flatten(t,this.size,2);e.uniform2fv(this.addr,r)}function setValueV3fArray(e,t){let r=flatten(t,this.size,3);e.uniform3fv(this.addr,r)}function setValueV4fArray(e,t){let r=flatten(t,this.size,4);e.uniform4fv(this.addr,r)}function setValueM2Array(e,t){let r=flatten(t,this.size,4);e.uniformMatrix2fv(this.addr,!1,r)}function setValueM3Array(e,t){let r=flatten(t,this.size,9);e.uniformMatrix3fv(this.addr,!1,r)}function setValueM4Array(e,t){let r=flatten(t,this.size,16);e.uniformMatrix4fv(this.addr,!1,r)}function setValueV1iArray(e,t){e.uniform1iv(this.addr,t)}function setValueV2iArray(e,t){e.uniform2iv(this.addr,t)}function setValueV3iArray(e,t){e.uniform3iv(this.addr,t)}function setValueV4iArray(e,t){e.uniform4iv(this.addr,t)}function setValueV1uiArray(e,t){e.uniform1uiv(this.addr,t)}function setValueV2uiArray(e,t){e.uniform2uiv(this.addr,t)}function setValueV3uiArray(e,t){e.uniform3uiv(this.addr,t)}function setValueV4uiArray(e,t){e.uniform4uiv(this.addr,t)}function setValueT1Array(e,t,r){let i,a=this.cache,n=t.length,o=allocTexUnits(r,n);arraysEqual(a,o)||(e.uniform1iv(this.addr,o),copyArray(a,o)),i=this.type===e.SAMPLER_2D_SHADOW?S:E;for(let e=0;e!==n;++e)r.setTexture2D(t[e]||i,o[e])}function setValueT3DArray(e,t,r){let i=this.cache,a=t.length,n=allocTexUnits(r,a);arraysEqual(i,n)||(e.uniform1iv(this.addr,n),copyArray(i,n));for(let e=0;e!==a;++e)r.setTexture3D(t[e]||M,n[e])}function setValueT6Array(e,t,r){let i=this.cache,a=t.length,n=allocTexUnits(r,a);arraysEqual(i,n)||(e.uniform1iv(this.addr,n),copyArray(i,n));for(let e=0;e!==a;++e)r.setTextureCube(t[e]||x,n[e])}function setValueT2DArrayArray(e,t,r){let i=this.cache,a=t.length,n=allocTexUnits(r,a);arraysEqual(i,n)||(e.uniform1iv(this.addr,n),copyArray(i,n));for(let e=0;e!==a;++e)r.setTexture2DArray(t[e]||T,n[e])}function getPureArraySetter(e){switch(e){case 5126:return setValueV1fArray;case 35664:return setValueV2fArray;case 35665:return setValueV3fArray;case 35666:return setValueV4fArray;case 35674:return setValueM2Array;case 35675:return setValueM3Array;case 35676:return setValueM4Array;case 5124:case 35670:return setValueV1iArray;case 35667:case 35671:return setValueV2iArray;case 35668:case 35672:return setValueV3iArray;case 35669:case 35673:return setValueV4iArray;case 5125:return setValueV1uiArray;case 36294:return setValueV2uiArray;case 36295:return setValueV3uiArray;case 36296:return setValueV4uiArray;case 35678:case 36198:case 36298:case 36306:case 35682:return setValueT1Array;case 35679:case 36299:case 36307:return setValueT3DArray;case 35680:case 36300:case 36308:case 36293:return setValueT6Array;case 36289:case 36303:case 36311:case 36292:return setValueT2DArrayArray}}let SingleUniform=class SingleUniform{constructor(e,t,r){this.id=e,this.addr=r,this.cache=[],this.type=t.type,this.setValue=getSingularSetter(t.type)}};let PureArrayUniform=class PureArrayUniform{constructor(e,t,r){this.id=e,this.addr=r,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=getPureArraySetter(t.type)}};let StructuredUniform=class StructuredUniform{setValue(e,t,r){let i=this.seq;for(let a=0,n=i.length;a!==n;++a){let n=i[a];n.setValue(e,t[n.id],r)}}constructor(e){this.id=e,this.seq=[],this.map={}}};let L=/(\w+)(\])?(\[|\.)?/g;function addUniform(e,t){e.seq.push(t),e.map[t.id]=t}function parseUniform(e,t,r){let i=e.name,a=i.length;for(L.lastIndex=0;;){let n=L.exec(i),o=L.lastIndex,s=n[1],l="]"===n[2],c=n[3];if(l&&(s|=0),void 0===c||"["===c&&o+2===a){addUniform(r,void 0===c?new SingleUniform(s,e,t):new PureArrayUniform(s,e,t));break}{let e=r.map[s];void 0===e&&addUniform(r,e=new StructuredUniform(s)),r=e}}}let WebGLUniforms=class WebGLUniforms{setValue(e,t,r,i){let a=this.map[t];void 0!==a&&a.setValue(e,r,i)}setOptional(e,t,r){let i=t[r];void 0!==i&&this.setValue(e,r,i)}static upload(e,t,r,i){for(let a=0,n=t.length;a!==n;++a){let n=t[a],o=r[n.id];!1!==o.needsUpdate&&n.setValue(e,o.value,i)}}static seqWithValue(e,t){let r=[];for(let i=0,a=e.length;i!==a;++i){let a=e[i];a.id in t&&r.push(a)}return r}constructor(e,t){this.seq=[],this.map={};const r=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let i=0;i<r;++i){const r=e.getActiveUniform(t,i),a=e.getUniformLocation(t,r.name);parseUniform(r,a,this)}const i=[],a=[];for(const t of this.seq)t.type===e.SAMPLER_2D_SHADOW||t.type===e.SAMPLER_CUBE_SHADOW||t.type===e.SAMPLER_2D_ARRAY_SHADOW?i.push(t):a.push(t);i.length>0&&(this.seq=i.concat(a))}};function WebGLShader(e,t,r){let i=e.createShader(t);return e.shaderSource(i,r),e.compileShader(i),i}let U=0;function handleSource(e,t){let r=e.split(`
`),i=[],a=Math.max(t-6,0),n=Math.min(t+6,r.length);for(let e=a;e<n;e++){let a=e+1;i.push("".concat(a===t?">":" "," ").concat(a,": ").concat(r[e]))}return i.join(`
`)}let D=new i.dwI;function getEncodingComponents(e){i.ppV._getMatrix(D,i.ppV.workingColorSpace,e);let t="mat3( ".concat(D.elements.map(e=>e.toFixed(4))," )");switch(i.ppV.getTransfer(e)){case"linear":return[t,"LinearTransferOETF"];case"srgb":return[t,"sRGBTransferOETF"];default:return(0,i.R8M)("WebGLProgram: Unsupported color space: ",e),[t,"LinearTransferOETF"]}}function getShaderErrors(e,t,r){let i=e.getShaderParameter(t,e.COMPILE_STATUS),a=(e.getShaderInfoLog(t)||"").trim();if(i&&""===a)return"";let n=/ERROR: 0:(\d+)/.exec(a);if(!n)return a;{let i=parseInt(n[1]);return r.toUpperCase()+`

`+a+`

`+handleSource(e.getShaderSource(t),i)}}function getTexelEncodingFunction(e,t){let r=getEncodingComponents(t);return["vec4 ".concat(e,"( vec4 value ) {"),"	return ".concat(r[1],"( vec4( value.rgb * ").concat(r[0],", value.a ) );"),"}"].join(`
`)}let w={1:"Linear",2:"Reinhard",3:"Cineon",4:"ACESFilmic",6:"AgX",7:"Neutral",5:"Custom"};function getToneMappingFunction(e,t){let r=w[t];return void 0===r?((0,i.R8M)("WebGLProgram: Unsupported toneMapping:",t),"vec3 "+e+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+e+"( vec3 color ) { return "+r+"ToneMapping( color ); }"}let I=new i.Pq0;function getLuminanceFunction(){i.ppV.getLuminanceCoefficients(I);let e=I.x.toFixed(4),t=I.y.toFixed(4),r=I.z.toFixed(4);return["float luminance( const in vec3 rgb ) {","	const vec3 weights = vec3( ".concat(e,", ").concat(t,", ").concat(r," );"),`	return dot( weights, rgb );
}`].join(`
`)}function generateVertexExtensions(e){return[e.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",e.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(filterEmptyLine).join(`
`)}function generateDefines(e){let t=[];for(let r in e){let i=e[r];!1!==i&&t.push("#define "+r+" "+i)}return t.join(`
`)}function fetchAttributeLocations(e,t){let r={},i=e.getProgramParameter(t,e.ACTIVE_ATTRIBUTES);for(let a=0;a<i;a++){let i=e.getActiveAttrib(t,a),n=i.name,o=1;i.type===e.FLOAT_MAT2&&(o=2),i.type===e.FLOAT_MAT3&&(o=3),i.type===e.FLOAT_MAT4&&(o=4),r[n]={type:i.type,location:e.getAttribLocation(t,n),locationSize:o}}return r}function filterEmptyLine(e){return""!==e}function replaceLightNums(e,t){let r=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return e.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,r).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function replaceClippingPlaneNums(e,t){return e.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}let y=/^[ \t]*#include +<([\w\d./]+)>/gm;function resolveIncludes(e){return e.replace(y,includeReplacer)}let N=new Map;function includeReplacer(e,t){let r=a[t];if(void 0===r){let e=N.get(t);if(void 0!==e)r=a[e],(0,i.R8M)('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,e);else throw Error("THREE.WebGLProgram: Can not resolve #include <"+t+">")}return resolveIncludes(r)}let F=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function unrollLoops(e){return e.replace(F,loopReplacer)}function loopReplacer(e,t,r,i){let a="";for(let e=parseInt(t);e<parseInt(r);e++)a+=i.replace(/\[\s*i\s*\]/g,"[ "+e+" ]").replace(/UNROLLED_LOOP_INDEX/g,e);return a}function generatePrecision(e){let t="precision ".concat(e.precision,` float;
	precision `).concat(e.precision,` int;
	precision `).concat(e.precision,` sampler2D;
	precision `).concat(e.precision,` samplerCube;
	precision `).concat(e.precision,` sampler3D;
	precision `).concat(e.precision,` sampler2DArray;
	precision `).concat(e.precision,` sampler2DShadow;
	precision `).concat(e.precision,` samplerCubeShadow;
	precision `).concat(e.precision,` sampler2DArrayShadow;
	precision `).concat(e.precision,` isampler2D;
	precision `).concat(e.precision,` isampler3D;
	precision `).concat(e.precision,` isamplerCube;
	precision `).concat(e.precision,` isampler2DArray;
	precision `).concat(e.precision,` usampler2D;
	precision `).concat(e.precision,` usampler3D;
	precision `).concat(e.precision,` usamplerCube;
	precision `).concat(e.precision,` usampler2DArray;
	`);return"highp"===e.precision?t+=`
#define HIGH_PRECISION`:"mediump"===e.precision?t+=`
#define MEDIUM_PRECISION`:"lowp"===e.precision&&(t+=`
#define LOW_PRECISION`),t}let O={1:"SHADOWMAP_TYPE_PCF",3:"SHADOWMAP_TYPE_VSM"};function generateShadowMapTypeDefine(e){return O[e.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}let B={301:"ENVMAP_TYPE_CUBE",302:"ENVMAP_TYPE_CUBE",306:"ENVMAP_TYPE_CUBE_UV"};function generateEnvMapTypeDefine(e){return!1===e.envMap?"ENVMAP_TYPE_CUBE":B[e.envMapMode]||"ENVMAP_TYPE_CUBE"}let G={302:"ENVMAP_MODE_REFRACTION"};function generateEnvMapModeDefine(e){return!1===e.envMap?"ENVMAP_MODE_REFLECTION":G[e.envMapMode]||"ENVMAP_MODE_REFLECTION"}let V={0:"ENVMAP_BLENDING_MULTIPLY",1:"ENVMAP_BLENDING_MIX",2:"ENVMAP_BLENDING_ADD"};function generateEnvMapBlendingDefine(e){return!1===e.envMap?"ENVMAP_BLENDING_NONE":V[e.combine]||"ENVMAP_BLENDING_NONE"}function generateCubeUVSize(e){let t=e.envMapCubeUVHeight;if(null===t)return null;let r=Math.log2(t)-2;return{texelWidth:1/(3*Math.max(Math.pow(2,r),112)),texelHeight:1/t,maxMip:r}}function WebGLProgram(e,t,r,n){let o,s,l,c,d=e.getContext(),u=r.defines,f=r.vertexShader,p=r.fragmentShader,m=generateShadowMapTypeDefine(r),h=generateEnvMapTypeDefine(r),g=generateEnvMapModeDefine(r),_=generateEnvMapBlendingDefine(r),v=generateCubeUVSize(r),E=generateVertexExtensions(r),S=generateDefines(u),T=d.createProgram(),M=r.glslVersion?"#version "+r.glslVersion+`
`:"";r.isRawShaderMaterial?((o=["#define SHADER_TYPE "+r.shaderType,"#define SHADER_NAME "+r.shaderName,S].filter(filterEmptyLine).join(`
`)).length>0&&(o+=`
`),(s=["#define SHADER_TYPE "+r.shaderType,"#define SHADER_NAME "+r.shaderName,S].filter(filterEmptyLine).join(`
`)).length>0&&(s+=`
`)):(o=[generatePrecision(r),"#define SHADER_TYPE "+r.shaderType,"#define SHADER_NAME "+r.shaderName,S,r.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",r.batching?"#define USE_BATCHING":"",r.batchingColor?"#define USE_BATCHING_COLOR":"",r.instancing?"#define USE_INSTANCING":"",r.instancingColor?"#define USE_INSTANCING_COLOR":"",r.instancingMorph?"#define USE_INSTANCING_MORPH":"",r.useFog&&r.fog?"#define USE_FOG":"",r.useFog&&r.fogExp2?"#define FOG_EXP2":"",r.map?"#define USE_MAP":"",r.envMap?"#define USE_ENVMAP":"",r.envMap?"#define "+g:"",r.lightMap?"#define USE_LIGHTMAP":"",r.aoMap?"#define USE_AOMAP":"",r.bumpMap?"#define USE_BUMPMAP":"",r.normalMap?"#define USE_NORMALMAP":"",r.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",r.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",r.displacementMap?"#define USE_DISPLACEMENTMAP":"",r.emissiveMap?"#define USE_EMISSIVEMAP":"",r.anisotropy?"#define USE_ANISOTROPY":"",r.anisotropyMap?"#define USE_ANISOTROPYMAP":"",r.clearcoatMap?"#define USE_CLEARCOATMAP":"",r.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",r.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",r.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",r.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",r.specularMap?"#define USE_SPECULARMAP":"",r.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",r.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",r.roughnessMap?"#define USE_ROUGHNESSMAP":"",r.metalnessMap?"#define USE_METALNESSMAP":"",r.alphaMap?"#define USE_ALPHAMAP":"",r.alphaHash?"#define USE_ALPHAHASH":"",r.transmission?"#define USE_TRANSMISSION":"",r.transmissionMap?"#define USE_TRANSMISSIONMAP":"",r.thicknessMap?"#define USE_THICKNESSMAP":"",r.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",r.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",r.mapUv?"#define MAP_UV "+r.mapUv:"",r.alphaMapUv?"#define ALPHAMAP_UV "+r.alphaMapUv:"",r.lightMapUv?"#define LIGHTMAP_UV "+r.lightMapUv:"",r.aoMapUv?"#define AOMAP_UV "+r.aoMapUv:"",r.emissiveMapUv?"#define EMISSIVEMAP_UV "+r.emissiveMapUv:"",r.bumpMapUv?"#define BUMPMAP_UV "+r.bumpMapUv:"",r.normalMapUv?"#define NORMALMAP_UV "+r.normalMapUv:"",r.displacementMapUv?"#define DISPLACEMENTMAP_UV "+r.displacementMapUv:"",r.metalnessMapUv?"#define METALNESSMAP_UV "+r.metalnessMapUv:"",r.roughnessMapUv?"#define ROUGHNESSMAP_UV "+r.roughnessMapUv:"",r.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+r.anisotropyMapUv:"",r.clearcoatMapUv?"#define CLEARCOATMAP_UV "+r.clearcoatMapUv:"",r.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+r.clearcoatNormalMapUv:"",r.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+r.clearcoatRoughnessMapUv:"",r.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+r.iridescenceMapUv:"",r.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+r.iridescenceThicknessMapUv:"",r.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+r.sheenColorMapUv:"",r.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+r.sheenRoughnessMapUv:"",r.specularMapUv?"#define SPECULARMAP_UV "+r.specularMapUv:"",r.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+r.specularColorMapUv:"",r.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+r.specularIntensityMapUv:"",r.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+r.transmissionMapUv:"",r.thicknessMapUv?"#define THICKNESSMAP_UV "+r.thicknessMapUv:"",r.vertexTangents&&!1===r.flatShading?"#define USE_TANGENT":"",r.vertexNormals?"#define HAS_NORMAL":"",r.vertexColors?"#define USE_COLOR":"",r.vertexAlphas?"#define USE_COLOR_ALPHA":"",r.vertexUv1s?"#define USE_UV1":"",r.vertexUv2s?"#define USE_UV2":"",r.vertexUv3s?"#define USE_UV3":"",r.pointsUvs?"#define USE_POINTS_UV":"",r.flatShading?"#define FLAT_SHADED":"",r.skinning?"#define USE_SKINNING":"",r.morphTargets?"#define USE_MORPHTARGETS":"",r.morphNormals&&!1===r.flatShading?"#define USE_MORPHNORMALS":"",r.morphColors?"#define USE_MORPHCOLORS":"",r.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+r.morphTextureStride:"",r.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+r.morphTargetsCount:"",r.doubleSided?"#define DOUBLE_SIDED":"",r.flipSided?"#define FLIP_SIDED":"",r.shadowMapEnabled?"#define USE_SHADOWMAP":"",r.shadowMapEnabled?"#define "+m:"",r.sizeAttenuation?"#define USE_SIZEATTENUATION":"",r.numLightProbes>0?"#define USE_LIGHT_PROBES":"",r.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",r.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(filterEmptyLine).join(`
`),s=[generatePrecision(r),"#define SHADER_TYPE "+r.shaderType,"#define SHADER_NAME "+r.shaderName,S,r.useFog&&r.fog?"#define USE_FOG":"",r.useFog&&r.fogExp2?"#define FOG_EXP2":"",r.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",r.map?"#define USE_MAP":"",r.matcap?"#define USE_MATCAP":"",r.envMap?"#define USE_ENVMAP":"",r.envMap?"#define "+h:"",r.envMap?"#define "+g:"",r.envMap?"#define "+_:"",v?"#define CUBEUV_TEXEL_WIDTH "+v.texelWidth:"",v?"#define CUBEUV_TEXEL_HEIGHT "+v.texelHeight:"",v?"#define CUBEUV_MAX_MIP "+v.maxMip+".0":"",r.lightMap?"#define USE_LIGHTMAP":"",r.aoMap?"#define USE_AOMAP":"",r.bumpMap?"#define USE_BUMPMAP":"",r.normalMap?"#define USE_NORMALMAP":"",r.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",r.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",r.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",r.emissiveMap?"#define USE_EMISSIVEMAP":"",r.anisotropy?"#define USE_ANISOTROPY":"",r.anisotropyMap?"#define USE_ANISOTROPYMAP":"",r.clearcoat?"#define USE_CLEARCOAT":"",r.clearcoatMap?"#define USE_CLEARCOATMAP":"",r.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",r.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",r.dispersion?"#define USE_DISPERSION":"",r.iridescence?"#define USE_IRIDESCENCE":"",r.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",r.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",r.specularMap?"#define USE_SPECULARMAP":"",r.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",r.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",r.roughnessMap?"#define USE_ROUGHNESSMAP":"",r.metalnessMap?"#define USE_METALNESSMAP":"",r.alphaMap?"#define USE_ALPHAMAP":"",r.alphaTest?"#define USE_ALPHATEST":"",r.alphaHash?"#define USE_ALPHAHASH":"",r.sheen?"#define USE_SHEEN":"",r.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",r.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",r.transmission?"#define USE_TRANSMISSION":"",r.transmissionMap?"#define USE_TRANSMISSIONMAP":"",r.thicknessMap?"#define USE_THICKNESSMAP":"",r.vertexTangents&&!1===r.flatShading?"#define USE_TANGENT":"",r.vertexColors||r.instancingColor?"#define USE_COLOR":"",r.vertexAlphas||r.batchingColor?"#define USE_COLOR_ALPHA":"",r.vertexUv1s?"#define USE_UV1":"",r.vertexUv2s?"#define USE_UV2":"",r.vertexUv3s?"#define USE_UV3":"",r.pointsUvs?"#define USE_POINTS_UV":"",r.gradientMap?"#define USE_GRADIENTMAP":"",r.flatShading?"#define FLAT_SHADED":"",r.doubleSided?"#define DOUBLE_SIDED":"",r.flipSided?"#define FLIP_SIDED":"",r.shadowMapEnabled?"#define USE_SHADOWMAP":"",r.shadowMapEnabled?"#define "+m:"",r.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",r.numLightProbes>0?"#define USE_LIGHT_PROBES":"",r.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",r.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",r.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",r.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",r.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",0!==r.toneMapping?"#define TONE_MAPPING":"",0!==r.toneMapping?a.tonemapping_pars_fragment:"",0!==r.toneMapping?getToneMappingFunction("toneMapping",r.toneMapping):"",r.dithering?"#define DITHERING":"",r.opaque?"#define OPAQUE":"",a.colorspace_pars_fragment,getTexelEncodingFunction("linearToOutputTexel",r.outputColorSpace),getLuminanceFunction(),r.useDepthPacking?"#define DEPTH_PACKING "+r.depthPacking:"",`
`].filter(filterEmptyLine).join(`
`)),f=replaceClippingPlaneNums(f=replaceLightNums(f=resolveIncludes(f),r),r),p=replaceClippingPlaneNums(p=replaceLightNums(p=resolveIncludes(p),r),r),f=unrollLoops(f),p=unrollLoops(p),!0!==r.isRawShaderMaterial&&(M=`#version 300 es
`,o=[E,`#define attribute in
#define varying out
#define texture2D texture`].join(`
`)+`
`+o,s=["#define varying in","300 es"===r.glslVersion?"":"layout(location = 0) out highp vec4 pc_fragColor;","300 es"===r.glslVersion?"":"#define gl_FragColor pc_fragColor",`#define gl_FragDepthEXT gl_FragDepth
#define texture2D texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLodEXT textureLod
#define texture2DProjLodEXT textureProjLod
#define textureCubeLodEXT textureLod
#define texture2DGradEXT textureGrad
#define texture2DProjGradEXT textureProjGrad
#define textureCubeGradEXT textureGrad`].join(`
`)+`
`+s);let x=M+o+f,R=M+s+p,b=WebGLShader(d,d.VERTEX_SHADER,x),A=WebGLShader(d,d.FRAGMENT_SHADER,R);function onFirstUse(t){if(e.debug.checkShaderErrors){let r=d.getProgramInfoLog(T)||"",a=d.getShaderInfoLog(b)||"",n=d.getShaderInfoLog(A)||"",l=r.trim(),c=a.trim(),u=n.trim(),f=!0,p=!0;if(!1===d.getProgramParameter(T,d.LINK_STATUS))if(f=!1,"function"==typeof e.debug.onShaderError)e.debug.onShaderError(d,T,b,A);else{let e=getShaderErrors(d,b,"vertex"),r=getShaderErrors(d,A,"fragment");(0,i.z3S)("WebGLProgram: Shader Error "+d.getError()+" - VALIDATE_STATUS "+d.getProgramParameter(T,d.VALIDATE_STATUS)+`

Material Name: `+t.name+`
Material Type: `+t.type+`

Program Info Log: `+l+`
`+e+`
`+r)}else""!==l?(0,i.R8M)("WebGLProgram: Program Info Log:",l):(""===c||""===u)&&(p=!1);p&&(t.diagnostics={runnable:f,programLog:l,vertexShader:{log:c,prefix:o},fragmentShader:{log:u,prefix:s}})}d.deleteShader(b),d.deleteShader(A),l=new WebGLUniforms(d,T),c=fetchAttributeLocations(d,T)}d.attachShader(T,b),d.attachShader(T,A),void 0!==r.index0AttributeName?d.bindAttribLocation(T,0,r.index0AttributeName):!0===r.hasPositionAttribute&&d.bindAttribLocation(T,0,"position"),d.linkProgram(T),this.getUniforms=function(){return void 0===l&&onFirstUse(this),l},this.getAttributes=function(){return void 0===c&&onFirstUse(this),c};let C=!1===r.rendererExtensionParallelShaderCompile;return this.isReady=function(){return!1===C&&(C=d.getProgramParameter(T,37297)),C},this.destroy=function(){n.releaseStatesOfProgram(this),d.deleteProgram(T),this.program=void 0},this.type=r.shaderType,this.name=r.shaderName,this.id=U++,this.cacheKey=t,this.usedTimes=1,this.program=T,this.vertexShader=b,this.fragmentShader=A,this}let H=0;let WebGLShaderCache=class WebGLShaderCache{update(e,t,r){let i=this._getShaderCacheForMaterial(e);return!1===i.has(t)&&(i.add(t),t.usedTimes++),!1===i.has(r)&&(i.add(r),r.usedTimes++),this}remove(e){for(let t of this.materialCache.get(e))t.usedTimes--,0===t.usedTimes&&this.shaderCache.delete(t.code);return this.materialCache.delete(e),this}getVertexShaderStage(e){return this._getShaderStage(e.vertexShader)}getFragmentShaderStage(e){return this._getShaderStage(e.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,r=t.get(e);return void 0===r&&(r=new Set,t.set(e,r)),r}_getShaderStage(e){let t=this.shaderCache,r=t.get(e);return void 0===r&&(r=new WebGLShaderStage(e),t.set(e,r)),r}constructor(){this.shaderCache=new Map,this.materialCache=new Map}};let WebGLShaderStage=class WebGLShaderStage{constructor(e){this.id=H++,this.code=e,this.usedTimes=0}};function isPackedRGFormat(e){return 1030===e||37490===e||36285===e}function WebGLPrograms(e,t,r,a,n,s){let l=new i.zgK,c=new WebGLShaderCache,d=new Set,u=[],f=new Map,p=a.logarithmicDepthBuffer,m=a.precision,h={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function getChannel(e){return(d.add(e),0===e)?"uv":"uv".concat(e)}function getProgramCacheKeyParameters(e,t){e.push(t.precision),e.push(t.outputColorSpace),e.push(t.envMapMode),e.push(t.envMapCubeUVHeight),e.push(t.mapUv),e.push(t.alphaMapUv),e.push(t.lightMapUv),e.push(t.aoMapUv),e.push(t.bumpMapUv),e.push(t.normalMapUv),e.push(t.displacementMapUv),e.push(t.emissiveMapUv),e.push(t.metalnessMapUv),e.push(t.roughnessMapUv),e.push(t.anisotropyMapUv),e.push(t.clearcoatMapUv),e.push(t.clearcoatNormalMapUv),e.push(t.clearcoatRoughnessMapUv),e.push(t.iridescenceMapUv),e.push(t.iridescenceThicknessMapUv),e.push(t.sheenColorMapUv),e.push(t.sheenRoughnessMapUv),e.push(t.specularMapUv),e.push(t.specularColorMapUv),e.push(t.specularIntensityMapUv),e.push(t.transmissionMapUv),e.push(t.thicknessMapUv),e.push(t.combine),e.push(t.fogExp2),e.push(t.sizeAttenuation),e.push(t.morphTargetsCount),e.push(t.morphAttributeCount),e.push(t.numDirLights),e.push(t.numPointLights),e.push(t.numSpotLights),e.push(t.numSpotLightMaps),e.push(t.numHemiLights),e.push(t.numRectAreaLights),e.push(t.numDirLightShadows),e.push(t.numPointLightShadows),e.push(t.numSpotLightShadows),e.push(t.numSpotLightShadowsWithMaps),e.push(t.numLightProbes),e.push(t.shadowMapType),e.push(t.toneMapping),e.push(t.numClippingPlanes),e.push(t.numClipIntersection),e.push(t.depthPacking)}function getProgramCacheKeyBooleans(e,t){l.disableAll(),t.instancing&&l.enable(0),t.instancingColor&&l.enable(1),t.instancingMorph&&l.enable(2),t.matcap&&l.enable(3),t.envMap&&l.enable(4),t.normalMapObjectSpace&&l.enable(5),t.normalMapTangentSpace&&l.enable(6),t.clearcoat&&l.enable(7),t.iridescence&&l.enable(8),t.alphaTest&&l.enable(9),t.vertexColors&&l.enable(10),t.vertexAlphas&&l.enable(11),t.vertexUv1s&&l.enable(12),t.vertexUv2s&&l.enable(13),t.vertexUv3s&&l.enable(14),t.vertexTangents&&l.enable(15),t.anisotropy&&l.enable(16),t.alphaHash&&l.enable(17),t.batching&&l.enable(18),t.dispersion&&l.enable(19),t.batchingColor&&l.enable(20),t.gradientMap&&l.enable(21),t.packedNormalMap&&l.enable(22),t.vertexNormals&&l.enable(23),e.push(l.mask),l.disableAll(),t.fog&&l.enable(0),t.useFog&&l.enable(1),t.flatShading&&l.enable(2),t.logarithmicDepthBuffer&&l.enable(3),t.reversedDepthBuffer&&l.enable(4),t.skinning&&l.enable(5),t.morphTargets&&l.enable(6),t.morphNormals&&l.enable(7),t.morphColors&&l.enable(8),t.premultipliedAlpha&&l.enable(9),t.shadowMapEnabled&&l.enable(10),t.doubleSided&&l.enable(11),t.flipSided&&l.enable(12),t.useDepthPacking&&l.enable(13),t.dithering&&l.enable(14),t.transmission&&l.enable(15),t.sheen&&l.enable(16),t.opaque&&l.enable(17),t.pointsUvs&&l.enable(18),t.decodeVideoTexture&&l.enable(19),t.decodeVideoTextureEmissive&&l.enable(20),t.alphaToCoverage&&l.enable(21),t.numLightProbeGrids>0&&l.enable(22),t.hasPositionAttribute&&l.enable(23),e.push(l.mask)}return{getParameters:function(n,l,u,f,g,_){let v,E,S,T,M=f.fog,x=g.geometry,R=n.isMeshStandardMaterial||n.isMeshLambertMaterial||n.isMeshPhongMaterial?f.environment:null,b=n.isMeshStandardMaterial||n.isMeshLambertMaterial&&!n.envMap||n.isMeshPhongMaterial&&!n.envMap,A=t.get(n.envMap||R,b),C=A&&306===A.mapping?A.image.height:null,P=h[n.type];null!==n.precision&&(m=a.getMaxPrecision(n.precision))!==n.precision&&(0,i.R8M)("WebGLProgram.getParameters:",n.precision,"not supported, using",m,"instead.");let L=x.morphAttributes.position||x.morphAttributes.normal||x.morphAttributes.color,U=void 0!==L?L.length:0,D=0;if(void 0!==x.morphAttributes.position&&(D=1),void 0!==x.morphAttributes.normal&&(D=2),void 0!==x.morphAttributes.color&&(D=3),P){let e=o[P];v=e.vertexShader,E=e.fragmentShader}else{v=n.vertexShader,E=n.fragmentShader;let e=c.getVertexShaderStage(n),t=c.getFragmentShaderStage(n);c.update(n,e,t),S=e.id,T=t.id}let w=e.getRenderTarget(),I=e.state.buffers.depth.getReversed(),y=!0===g.isInstancedMesh,N=!0===g.isBatchedMesh,F=!!n.map,O=!!n.matcap,B=!!A,G=!!n.aoMap,V=!!n.lightMap,H=!!n.bumpMap&&!1===n.wireframe,W=!!n.normalMap,z=!!n.displacementMap,k=!!n.emissiveMap,X=!!n.metalnessMap,q=!!n.roughnessMap,Y=n.anisotropy>0,j=n.clearcoat>0,K=n.dispersion>0,Z=n.iridescence>0,Q=n.sheen>0,J=n.transmission>0,$=Y&&!!n.anisotropyMap,ee=j&&!!n.clearcoatMap,et=j&&!!n.clearcoatNormalMap,er=j&&!!n.clearcoatRoughnessMap,ei=Z&&!!n.iridescenceMap,ea=Z&&!!n.iridescenceThicknessMap,en=Q&&!!n.sheenColorMap,eo=Q&&!!n.sheenRoughnessMap,es=!!n.specularMap,el=!!n.specularColorMap,ec=!!n.specularIntensityMap,ed=J&&!!n.transmissionMap,eu=J&&!!n.thicknessMap,ef=!!n.gradientMap,ep=!!n.alphaMap,em=n.alphaTest>0,eh=!!n.alphaHash,eg=!!n.extensions,e_=0;n.toneMapped&&(null===w||!0===w.isXRRenderTarget)&&(e_=e.toneMapping);let ev={shaderID:P,shaderType:n.type,shaderName:n.name,vertexShader:v,fragmentShader:E,defines:n.defines,customVertexShaderID:S,customFragmentShaderID:T,isRawShaderMaterial:!0===n.isRawShaderMaterial,glslVersion:n.glslVersion,precision:m,batching:N,batchingColor:N&&null!==g._colorsTexture,instancing:y,instancingColor:y&&null!==g.instanceColor,instancingMorph:y&&null!==g.morphTexture,outputColorSpace:null===w?e.outputColorSpace:!0===w.isXRRenderTarget?w.texture.colorSpace:i.ppV.workingColorSpace,alphaToCoverage:!!n.alphaToCoverage,map:F,matcap:O,envMap:B,envMapMode:B&&A.mapping,envMapCubeUVHeight:C,aoMap:G,lightMap:V,bumpMap:H,normalMap:W,displacementMap:z,emissiveMap:k,normalMapObjectSpace:W&&1===n.normalMapType,normalMapTangentSpace:W&&0===n.normalMapType,packedNormalMap:W&&0===n.normalMapType&&isPackedRGFormat(n.normalMap.format),metalnessMap:X,roughnessMap:q,anisotropy:Y,anisotropyMap:$,clearcoat:j,clearcoatMap:ee,clearcoatNormalMap:et,clearcoatRoughnessMap:er,dispersion:K,iridescence:Z,iridescenceMap:ei,iridescenceThicknessMap:ea,sheen:Q,sheenColorMap:en,sheenRoughnessMap:eo,specularMap:es,specularColorMap:el,specularIntensityMap:ec,transmission:J,transmissionMap:ed,thicknessMap:eu,gradientMap:ef,opaque:!1===n.transparent&&1===n.blending&&!1===n.alphaToCoverage,alphaMap:ep,alphaTest:em,alphaHash:eh,combine:n.combine,mapUv:F&&getChannel(n.map.channel),aoMapUv:G&&getChannel(n.aoMap.channel),lightMapUv:V&&getChannel(n.lightMap.channel),bumpMapUv:H&&getChannel(n.bumpMap.channel),normalMapUv:W&&getChannel(n.normalMap.channel),displacementMapUv:z&&getChannel(n.displacementMap.channel),emissiveMapUv:k&&getChannel(n.emissiveMap.channel),metalnessMapUv:X&&getChannel(n.metalnessMap.channel),roughnessMapUv:q&&getChannel(n.roughnessMap.channel),anisotropyMapUv:$&&getChannel(n.anisotropyMap.channel),clearcoatMapUv:ee&&getChannel(n.clearcoatMap.channel),clearcoatNormalMapUv:et&&getChannel(n.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:er&&getChannel(n.clearcoatRoughnessMap.channel),iridescenceMapUv:ei&&getChannel(n.iridescenceMap.channel),iridescenceThicknessMapUv:ea&&getChannel(n.iridescenceThicknessMap.channel),sheenColorMapUv:en&&getChannel(n.sheenColorMap.channel),sheenRoughnessMapUv:eo&&getChannel(n.sheenRoughnessMap.channel),specularMapUv:es&&getChannel(n.specularMap.channel),specularColorMapUv:el&&getChannel(n.specularColorMap.channel),specularIntensityMapUv:ec&&getChannel(n.specularIntensityMap.channel),transmissionMapUv:ed&&getChannel(n.transmissionMap.channel),thicknessMapUv:eu&&getChannel(n.thicknessMap.channel),alphaMapUv:ep&&getChannel(n.alphaMap.channel),vertexTangents:!!x.attributes.tangent&&(W||Y),vertexNormals:!!x.attributes.normal,vertexColors:n.vertexColors,vertexAlphas:!0===n.vertexColors&&!!x.attributes.color&&4===x.attributes.color.itemSize,pointsUvs:!0===g.isPoints&&!!x.attributes.uv&&(F||ep),fog:!!M,useFog:!0===n.fog,fogExp2:!!M&&M.isFogExp2,flatShading:!1===n.wireframe&&(!0===n.flatShading||void 0===x.attributes.normal&&!1===W&&(n.isMeshLambertMaterial||n.isMeshPhongMaterial||n.isMeshStandardMaterial||n.isMeshPhysicalMaterial)),sizeAttenuation:!0===n.sizeAttenuation,logarithmicDepthBuffer:p,reversedDepthBuffer:I,skinning:!0===g.isSkinnedMesh,hasPositionAttribute:void 0!==x.attributes.position,morphTargets:void 0!==x.morphAttributes.position,morphNormals:void 0!==x.morphAttributes.normal,morphColors:void 0!==x.morphAttributes.color,morphTargetsCount:U,morphTextureStride:D,numDirLights:l.directional.length,numPointLights:l.point.length,numSpotLights:l.spot.length,numSpotLightMaps:l.spotLightMap.length,numRectAreaLights:l.rectArea.length,numHemiLights:l.hemi.length,numDirLightShadows:l.directionalShadowMap.length,numPointLightShadows:l.pointShadowMap.length,numSpotLightShadows:l.spotShadowMap.length,numSpotLightShadowsWithMaps:l.numSpotLightShadowsWithMaps,numLightProbes:l.numLightProbes,numLightProbeGrids:_.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:n.dithering,shadowMapEnabled:e.shadowMap.enabled&&u.length>0,shadowMapType:e.shadowMap.type,toneMapping:e_,decodeVideoTexture:F&&!0===n.map.isVideoTexture&&"srgb"===i.ppV.getTransfer(n.map.colorSpace),decodeVideoTextureEmissive:k&&!0===n.emissiveMap.isVideoTexture&&"srgb"===i.ppV.getTransfer(n.emissiveMap.colorSpace),premultipliedAlpha:n.premultipliedAlpha,doubleSided:2===n.side,flipSided:1===n.side,useDepthPacking:n.depthPacking>=0,depthPacking:n.depthPacking||0,index0AttributeName:n.index0AttributeName,extensionClipCullDistance:eg&&!0===n.extensions.clipCullDistance&&r.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(eg&&!0===n.extensions.multiDraw||N)&&r.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:r.has("KHR_parallel_shader_compile"),customProgramCacheKey:n.customProgramCacheKey()};return ev.vertexUv1s=d.has(1),ev.vertexUv2s=d.has(2),ev.vertexUv3s=d.has(3),d.clear(),ev},getProgramCacheKey:function(t){let r=[];if(t.shaderID?r.push(t.shaderID):(r.push(t.customVertexShaderID),r.push(t.customFragmentShaderID)),void 0!==t.defines)for(let e in t.defines)r.push(e),r.push(t.defines[e]);return!1===t.isRawShaderMaterial&&(getProgramCacheKeyParameters(r,t),getProgramCacheKeyBooleans(r,t),r.push(e.outputColorSpace)),r.push(t.customProgramCacheKey),r.join()},getUniforms:function(e){let t,r=h[e.type];if(r){let e=o[r];t=i.LlO.clone(e.uniforms)}else t=e.uniforms;return t},acquireProgram:function(t,r){let i=f.get(r);return void 0!==i?++i.usedTimes:(i=new WebGLProgram(e,r,t,n),u.push(i),f.set(r,i)),i},releaseProgram:function(e){if(0==--e.usedTimes){let t=u.indexOf(e);u[t]=u[u.length-1],u.pop(),f.delete(e.cacheKey),e.destroy()}},releaseShaderCache:function(e){c.remove(e)},programs:u,dispose:function(){c.dispose()}}}function WebGLProperties(){let e=new WeakMap;return{has:function(t){return e.has(t)},get:function(t){let r=e.get(t);return void 0===r&&(r={},e.set(t,r)),r},remove:function(t){e.delete(t)},update:function(t,r,i){e.get(t)[r]=i},dispose:function(){e=new WeakMap}}}function painterSortStable(e,t){if(e.groupOrder!==t.groupOrder)return e.groupOrder-t.groupOrder;if(e.renderOrder!==t.renderOrder)return e.renderOrder-t.renderOrder;if(e.material.id!==t.material.id)return e.material.id-t.material.id;if(e.materialVariant!==t.materialVariant)return e.materialVariant-t.materialVariant;if(e.z!==t.z)return e.z-t.z;else return e.id-t.id}function reversePainterSortStable(e,t){return e.groupOrder!==t.groupOrder?e.groupOrder-t.groupOrder:e.renderOrder!==t.renderOrder?e.renderOrder-t.renderOrder:e.z!==t.z?t.z-e.z:e.id-t.id}function WebGLRenderList(){let e=[],t=0,r=[],i=[],a=[];function init(){t=0,r.length=0,i.length=0,a.length=0}function materialVariant(e){let t=0;return e.isInstancedMesh&&(t+=2),e.isSkinnedMesh&&(t+=1),t}function getNextRenderItem(r,i,a,n,o,s){let l=e[t];return void 0===l?(l={id:r.id,object:r,geometry:i,material:a,materialVariant:materialVariant(r),groupOrder:n,renderOrder:r.renderOrder,z:o,group:s},e[t]=l):(l.id=r.id,l.object=r,l.geometry=i,l.material=a,l.materialVariant=materialVariant(r),l.groupOrder=n,l.renderOrder=r.renderOrder,l.z=o,l.group=s),t++,l}function push(e,t,n,o,s,l){let c=getNextRenderItem(e,t,n,o,s,l);n.transmission>0?i.push(c):!0===n.transparent?a.push(c):r.push(c)}function unshift(e,t,n,o,s,l){let c=getNextRenderItem(e,t,n,o,s,l);n.transmission>0?i.unshift(c):!0===n.transparent?a.unshift(c):r.unshift(c)}function sort(e,t,n){r.length>1&&r.sort(e||painterSortStable),i.length>1&&i.sort(t||reversePainterSortStable),a.length>1&&a.sort(t||reversePainterSortStable),n&&(r.reverse(),i.reverse(),a.reverse())}return{opaque:r,transmissive:i,transparent:a,init:init,push:push,unshift:unshift,finish:function(){for(let r=t,i=e.length;r<i;r++){let t=e[r];if(null===t.id)break;t.id=null,t.object=null,t.geometry=null,t.material=null,t.group=null}},sort:sort}}function WebGLRenderLists(){let e=new WeakMap;return{get:function(t,r){let i,a=e.get(t);return void 0===a?(i=new WebGLRenderList,e.set(t,[i])):r>=a.length?(i=new WebGLRenderList,a.push(i)):i=a[r],i},dispose:function(){e=new WeakMap}}}function UniformsCache(){let e={};return{get:function(t){let r;if(void 0!==e[t.id])return e[t.id];switch(t.type){case"DirectionalLight":r={direction:new i.Pq0,color:new i.Q1f};break;case"SpotLight":r={position:new i.Pq0,direction:new i.Pq0,color:new i.Q1f,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":r={position:new i.Pq0,color:new i.Q1f,distance:0,decay:0};break;case"HemisphereLight":r={direction:new i.Pq0,skyColor:new i.Q1f,groundColor:new i.Q1f};break;case"RectAreaLight":r={color:new i.Q1f,position:new i.Pq0,halfWidth:new i.Pq0,halfHeight:new i.Pq0}}return e[t.id]=r,r}}}function ShadowUniformsCache(){let e={};return{get:function(t){let r;if(void 0!==e[t.id])return e[t.id];switch(t.type){case"DirectionalLight":case"SpotLight":r={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new i.I9Y};break;case"PointLight":r={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new i.I9Y,shadowCameraNear:1,shadowCameraFar:1e3}}return e[t.id]=r,r}}}let W=0;function shadowCastingAndTexturingLightsFirst(e,t){return 2*!!t.castShadow-2*!!e.castShadow+ +!!t.map-!!e.map}function WebGLLights(e){let t=new UniformsCache,r=ShadowUniformsCache(),a={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let e=0;e<9;e++)a.probe.push(new i.Pq0);let o=new i.Pq0,s=new i.kn4,l=new i.kn4;return{setup:function(i){let o=0,s=0,l=0;for(let e=0;e<9;e++)a.probe[e].set(0,0,0);let c=0,d=0,u=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0,E=0;i.sort(shadowCastingAndTexturingLightsFirst);for(let e=0,n=i.length;e<n;e++){let n=i[e],S=n.color,T=n.intensity,M=n.distance,x=null;if(n.shadow&&n.shadow.map&&(x=1030===n.shadow.map.texture.format?n.shadow.map.texture:n.shadow.map.depthTexture||n.shadow.map.texture),n.isAmbientLight)o+=S.r*T,s+=S.g*T,l+=S.b*T;else if(n.isLightProbe){for(let e=0;e<9;e++)a.probe[e].addScaledVector(n.sh.coefficients[e],T);E++}else if(n.isDirectionalLight){let e=t.get(n);if(e.color.copy(n.color).multiplyScalar(n.intensity),n.castShadow){let e=n.shadow,t=r.get(n);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,a.directionalShadow[c]=t,a.directionalShadowMap[c]=x,a.directionalShadowMatrix[c]=n.shadow.matrix,m++}a.directional[c]=e,c++}else if(n.isSpotLight){let e=t.get(n);e.position.setFromMatrixPosition(n.matrixWorld),e.color.copy(S).multiplyScalar(T),e.distance=M,e.coneCos=Math.cos(n.angle),e.penumbraCos=Math.cos(n.angle*(1-n.penumbra)),e.decay=n.decay,a.spot[u]=e;let i=n.shadow;if(n.map&&(a.spotLightMap[_]=n.map,_++,i.updateMatrices(n),n.castShadow&&v++),a.spotLightMatrix[u]=i.matrix,n.castShadow){let e=r.get(n);e.shadowIntensity=i.intensity,e.shadowBias=i.bias,e.shadowNormalBias=i.normalBias,e.shadowRadius=i.radius,e.shadowMapSize=i.mapSize,a.spotShadow[u]=e,a.spotShadowMap[u]=x,g++}u++}else if(n.isRectAreaLight){let e=t.get(n);e.color.copy(S).multiplyScalar(T),e.halfWidth.set(.5*n.width,0,0),e.halfHeight.set(0,.5*n.height,0),a.rectArea[f]=e,f++}else if(n.isPointLight){let e=t.get(n);if(e.color.copy(n.color).multiplyScalar(n.intensity),e.distance=n.distance,e.decay=n.decay,n.castShadow){let e=n.shadow,t=r.get(n);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,t.shadowCameraNear=e.camera.near,t.shadowCameraFar=e.camera.far,a.pointShadow[d]=t,a.pointShadowMap[d]=x,a.pointShadowMatrix[d]=n.shadow.matrix,h++}a.point[d]=e,d++}else if(n.isHemisphereLight){let e=t.get(n);e.skyColor.copy(n.color).multiplyScalar(T),e.groundColor.copy(n.groundColor).multiplyScalar(T),a.hemi[p]=e,p++}}f>0&&(!0===e.has("OES_texture_float_linear")?(a.rectAreaLTC1=n.LTC_FLOAT_1,a.rectAreaLTC2=n.LTC_FLOAT_2):(a.rectAreaLTC1=n.LTC_HALF_1,a.rectAreaLTC2=n.LTC_HALF_2)),a.ambient[0]=o,a.ambient[1]=s,a.ambient[2]=l;let S=a.hash;(S.directionalLength!==c||S.pointLength!==d||S.spotLength!==u||S.rectAreaLength!==f||S.hemiLength!==p||S.numDirectionalShadows!==m||S.numPointShadows!==h||S.numSpotShadows!==g||S.numSpotMaps!==_||S.numLightProbes!==E)&&(a.directional.length=c,a.spot.length=u,a.rectArea.length=f,a.point.length=d,a.hemi.length=p,a.directionalShadow.length=m,a.directionalShadowMap.length=m,a.pointShadow.length=h,a.pointShadowMap.length=h,a.spotShadow.length=g,a.spotShadowMap.length=g,a.directionalShadowMatrix.length=m,a.pointShadowMatrix.length=h,a.spotLightMatrix.length=g+_-v,a.spotLightMap.length=_,a.numSpotLightShadowsWithMaps=v,a.numLightProbes=E,S.directionalLength=c,S.pointLength=d,S.spotLength=u,S.rectAreaLength=f,S.hemiLength=p,S.numDirectionalShadows=m,S.numPointShadows=h,S.numSpotShadows=g,S.numSpotMaps=_,S.numLightProbes=E,a.version=W++)},setupView:function(e,t){let r=0,i=0,n=0,c=0,d=0,u=t.matrixWorldInverse;for(let t=0,f=e.length;t<f;t++){let f=e[t];if(f.isDirectionalLight){let e=a.directional[r];e.direction.setFromMatrixPosition(f.matrixWorld),o.setFromMatrixPosition(f.target.matrixWorld),e.direction.sub(o),e.direction.transformDirection(u),r++}else if(f.isSpotLight){let e=a.spot[n];e.position.setFromMatrixPosition(f.matrixWorld),e.position.applyMatrix4(u),e.direction.setFromMatrixPosition(f.matrixWorld),o.setFromMatrixPosition(f.target.matrixWorld),e.direction.sub(o),e.direction.transformDirection(u),n++}else if(f.isRectAreaLight){let e=a.rectArea[c];e.position.setFromMatrixPosition(f.matrixWorld),e.position.applyMatrix4(u),l.identity(),s.copy(f.matrixWorld),s.premultiply(u),l.extractRotation(s),e.halfWidth.set(.5*f.width,0,0),e.halfHeight.set(0,.5*f.height,0),e.halfWidth.applyMatrix4(l),e.halfHeight.applyMatrix4(l),c++}else if(f.isPointLight){let e=a.point[i];e.position.setFromMatrixPosition(f.matrixWorld),e.position.applyMatrix4(u),i++}else if(f.isHemisphereLight){let e=a.hemi[d];e.direction.setFromMatrixPosition(f.matrixWorld),e.direction.transformDirection(u),d++}}},state:a}}function WebGLRenderState(e){let t=new WebGLLights(e),r=[],i=[],a=[];function init(e){n.camera=e,r.length=0,i.length=0,a.length=0}function pushLight(e){r.push(e)}function pushShadow(e){i.push(e)}function pushLightProbeGrid(e){a.push(e)}function setupLights(){t.setup(r)}function setupLightsView(e){t.setupView(r,e)}let n={lightsArray:r,shadowsArray:i,lightProbeGridArray:a,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:init,state:n,setupLights:setupLights,setupLightsView:setupLightsView,pushLight:pushLight,pushShadow:pushShadow,pushLightProbeGrid:pushLightProbeGrid}}function WebGLRenderStates(e){let t=new WeakMap;return{get:function(r){let i,a=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0,n=t.get(r);return void 0===n?(i=new WebGLRenderState(e),t.set(r,[i])):a>=n.length?(i=new WebGLRenderState(e),n.push(i)):i=n[a],i},dispose:function(){t=new WeakMap}}}let z=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,k=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,X=[new i.Pq0(1,0,0),new i.Pq0(-1,0,0),new i.Pq0(0,1,0),new i.Pq0(0,-1,0),new i.Pq0(0,0,1),new i.Pq0(0,0,-1)],q=[new i.Pq0(0,-1,0),new i.Pq0(0,-1,0),new i.Pq0(0,0,1),new i.Pq0(0,0,-1),new i.Pq0(0,-1,0),new i.Pq0(0,-1,0)],Y=new i.kn4,j=new i.Pq0,K=new i.Pq0;function WebGLShadowMap(e,t,r){let a=new i.PPD,n=new i.I9Y,o=new i.I9Y,s=new i.IUQ,l=new i.CSG,c=new i.aVO,d={},u=r.maxTextureSize,f={0:1,1:0,2:2},p=new i.BKk({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new i.I9Y},radius:{value:4}},vertexShader:z,fragmentShader:k}),m=p.clone();m.defines.HORIZONTAL_PASS=1;let h=new i.LoY;h.setAttribute("position",new i.THS(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let g=new i.eaF(h,p),_=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=1;let v=this.type;function VSMPass(r,a){let o=t.update(g);p.defines.VSM_SAMPLES!==r.blurSamples&&(p.defines.VSM_SAMPLES=r.blurSamples,m.defines.VSM_SAMPLES=r.blurSamples,p.needsUpdate=!0,m.needsUpdate=!0),null===r.mapPass&&(r.mapPass=new i.nWS(n.x,n.y,{format:1030,type:1016})),p.uniforms.shadow_pass.value=r.map.depthTexture,p.uniforms.resolution.value=r.mapSize,p.uniforms.radius.value=r.radius,e.setRenderTarget(r.mapPass),e.clear(),e.renderBufferDirect(a,null,o,p,g,null),m.uniforms.shadow_pass.value=r.mapPass.texture,m.uniforms.resolution.value=r.mapSize,m.uniforms.radius.value=r.radius,e.setRenderTarget(r.map),e.clear(),e.renderBufferDirect(a,null,o,m,g,null)}function getDepthMaterial(t,r,i,a){let n=null,o=!0===i.isPointLight?t.customDistanceMaterial:t.customDepthMaterial;if(void 0!==o)n=o;else if(n=!0===i.isPointLight?c:l,e.localClippingEnabled&&!0===r.clipShadows&&Array.isArray(r.clippingPlanes)&&0!==r.clippingPlanes.length||r.displacementMap&&0!==r.displacementScale||r.alphaMap&&r.alphaTest>0||r.map&&r.alphaTest>0||!0===r.alphaToCoverage){let e=n.uuid,t=r.uuid,i=d[e];void 0===i&&(i={},d[e]=i);let a=i[t];void 0===a&&(a=n.clone(),i[t]=a,r.addEventListener("dispose",onMaterialDispose)),n=a}return n.visible=r.visible,n.wireframe=r.wireframe,3===a?n.side=null!==r.shadowSide?r.shadowSide:r.side:n.side=null!==r.shadowSide?r.shadowSide:f[r.side],n.alphaMap=r.alphaMap,n.alphaTest=!0===r.alphaToCoverage?.5:r.alphaTest,n.map=r.map,n.clipShadows=r.clipShadows,n.clippingPlanes=r.clippingPlanes,n.clipIntersection=r.clipIntersection,n.displacementMap=r.displacementMap,n.displacementScale=r.displacementScale,n.displacementBias=r.displacementBias,n.wireframeLinewidth=r.wireframeLinewidth,n.linewidth=r.linewidth,!0===i.isPointLight&&!0===n.isMeshDistanceMaterial&&(e.properties.get(n).light=i),n}function renderObject(r,i,n,o,s){if(!1===r.visible)return;if(r.layers.test(i.layers)&&(r.isMesh||r.isLine||r.isPoints)&&(r.castShadow||r.receiveShadow&&3===s)&&(!r.frustumCulled||a.intersectsObject(r))){r.modelViewMatrix.multiplyMatrices(n.matrixWorldInverse,r.matrixWorld);let a=t.update(r),l=r.material;if(Array.isArray(l)){let t=a.groups;for(let c=0,d=t.length;c<d;c++){let d=t[c],u=l[d.materialIndex];if(u&&u.visible){let t=getDepthMaterial(r,u,o,s);r.onBeforeShadow(e,r,i,n,a,t,d),e.renderBufferDirect(n,null,a,t,r,d),r.onAfterShadow(e,r,i,n,a,t,d)}}}else if(l.visible){let t=getDepthMaterial(r,l,o,s);r.onBeforeShadow(e,r,i,n,a,t,null),e.renderBufferDirect(n,null,a,t,r,null),r.onAfterShadow(e,r,i,n,a,t,null)}}let l=r.children;for(let e=0,t=l.length;e<t;e++)renderObject(l[e],i,n,o,s)}function onMaterialDispose(e){for(let t in e.target.removeEventListener("dispose",onMaterialDispose),d){let r=d[t],i=e.target.uuid;i in r&&(r[i].dispose(),delete r[i])}}this.render=function(t,r,l){if(!1===_.enabled||!1===_.autoUpdate&&!1===_.needsUpdate||0===t.length)return;2===this.type&&((0,i.R8M)("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=1);let c=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),p=e.state;p.setBlending(0),!0===p.buffers.depth.getReversed()?p.buffers.color.setClear(0,0,0,0):p.buffers.color.setClear(1,1,1,1),p.buffers.depth.setTest(!0),p.setScissorTest(!1);let m=v!==this.type;m&&r.traverse(function(e){e.material&&(Array.isArray(e.material)?e.material.forEach(e=>e.needsUpdate=!0):e.material.needsUpdate=!0)});for(let c=0,d=t.length;c<d;c++){let d=t[c],f=d.shadow;if(void 0===f){(0,i.R8M)("WebGLShadowMap:",d,"has no shadow.");continue}if(!1===f.autoUpdate&&!1===f.needsUpdate)continue;n.copy(f.mapSize);let h=f.getFrameExtents();n.multiply(h),o.copy(f.mapSize),(n.x>u||n.y>u)&&(n.x>u&&(o.x=Math.floor(u/h.x),n.x=o.x*h.x,f.mapSize.x=o.x),n.y>u&&(o.y=Math.floor(u/h.y),n.y=o.y*h.y,f.mapSize.y=o.y));let g=e.state.buffers.depth.getReversed();if(f.camera._reversedDepth=g,null===f.map||!0===m){if(null!==f.map&&(null!==f.map.depthTexture&&(f.map.depthTexture.dispose(),f.map.depthTexture=null),f.map.dispose()),3===this.type){if(d.isPointLight){(0,i.R8M)("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}f.map=new i.nWS(n.x,n.y,{format:1030,type:1016,minFilter:1006,magFilter:1006,generateMipmaps:!1}),f.map.texture.name=d.name+".shadowMap",f.map.depthTexture=new i.VCu(n.x,n.y,1015),f.map.depthTexture.name=d.name+".shadowMapDepth",f.map.depthTexture.format=1026,f.map.depthTexture.compareFunction=null,f.map.depthTexture.minFilter=1003,f.map.depthTexture.magFilter=1003}else d.isPointLight?(f.map=new WebGLCubeRenderTarget(n.x),f.map.depthTexture=new i.Gc6(n.x,1014)):(f.map=new i.nWS(n.x,n.y),f.map.depthTexture=new i.VCu(n.x,n.y,1014)),f.map.depthTexture.name=d.name+".shadowMap",f.map.depthTexture.format=1026,1===this.type?(f.map.depthTexture.compareFunction=g?518:515,f.map.depthTexture.minFilter=1006,f.map.depthTexture.magFilter=1006):(f.map.depthTexture.compareFunction=null,f.map.depthTexture.minFilter=1003,f.map.depthTexture.magFilter=1003);f.camera.updateProjectionMatrix()}let _=f.map.isWebGLCubeRenderTarget?6:1;for(let t=0;t<_;t++){if(f.map.isWebGLCubeRenderTarget)e.setRenderTarget(f.map,t),e.clear();else{0===t&&(e.setRenderTarget(f.map),e.clear());let r=f.getViewport(t);s.set(o.x*r.x,o.y*r.y,o.x*r.z,o.y*r.w),p.viewport(s)}if(d.isPointLight){let e=f.camera,r=f.matrix,i=d.distance||e.far;i!==e.far&&(e.far=i,e.updateProjectionMatrix()),j.setFromMatrixPosition(d.matrixWorld),e.position.copy(j),K.copy(e.position),K.add(X[t]),e.up.copy(q[t]),e.lookAt(K),e.updateMatrixWorld(),r.makeTranslation(-j.x,-j.y,-j.z),Y.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),f._frustum.setFromProjectionMatrix(Y,e.coordinateSystem,e.reversedDepth)}else f.updateMatrices(d);a=f.getFrustum(),renderObject(r,l,f.camera,d,this.type)}!0!==f.isPointLightShadow&&3===this.type&&VSMPass(f,l),f.needsUpdate=!1}v=this.type,_.needsUpdate=!1,e.setRenderTarget(c,d,f)}}function WebGLState(e,t){function DepthBuffer(){let r=!1,a=!1,n=null,o=null,s=null;return{setReversed:function(e){if(a!==e){let r=t.get("EXT_clip_control");e?r.clipControlEXT(r.LOWER_LEFT_EXT,r.ZERO_TO_ONE_EXT):r.clipControlEXT(r.LOWER_LEFT_EXT,r.NEGATIVE_ONE_TO_ONE_EXT),a=e;let i=s;s=null,this.setClear(i)}},getReversed:function(){return a},setTest:function(t){t?enable(e.DEPTH_TEST):disable(e.DEPTH_TEST)},setMask:function(t){n===t||r||(e.depthMask(t),n=t)},setFunc:function(t){if(a&&(t=i.ri6[t]),o!==t){switch(t){case 0:e.depthFunc(e.NEVER);break;case 1:e.depthFunc(e.ALWAYS);break;case 2:e.depthFunc(e.LESS);break;case 3:default:e.depthFunc(e.LEQUAL);break;case 4:e.depthFunc(e.EQUAL);break;case 5:e.depthFunc(e.GEQUAL);break;case 6:e.depthFunc(e.GREATER);break;case 7:e.depthFunc(e.NOTEQUAL)}o=t}},setLocked:function(e){r=e},setClear:function(t){s!==t&&(s=t,a&&(t=1-t),e.clearDepth(t))},reset:function(){r=!1,n=null,o=null,s=null,a=!1}}}function StencilBuffer(){let t=!1,r=null,i=null,a=null,n=null,o=null,s=null,l=null,c=null;return{setTest:function(r){t||(r?enable(e.STENCIL_TEST):disable(e.STENCIL_TEST))},setMask:function(i){r===i||t||(e.stencilMask(i),r=i)},setFunc:function(t,r,o){(i!==t||a!==r||n!==o)&&(e.stencilFunc(t,r,o),i=t,a=r,n=o)},setOp:function(t,r,i){(o!==t||s!==r||l!==i)&&(e.stencilOp(t,r,i),o=t,s=r,l=i)},setLocked:function(e){t=e},setClear:function(t){c!==t&&(e.clearStencil(t),c=t)},reset:function(){t=!1,r=null,i=null,a=null,n=null,o=null,s=null,l=null,c=null}}}let r=new function(){let t=!1,r=new i.IUQ,a=null,n=new i.IUQ(0,0,0,0);return{setMask:function(r){a===r||t||(e.colorMask(r,r,r,r),a=r)},setLocked:function(e){t=e},setClear:function(t,i,a,o,s){!0===s&&(t*=o,i*=o,a*=o),r.set(t,i,a,o),!1===n.equals(r)&&(e.clearColor(t,i,a,o),n.copy(r))},reset:function(){t=!1,a=null,n.set(-1,0,0,0)}}},a=new DepthBuffer,n=new StencilBuffer,o=new WeakMap,s=new WeakMap,l={},c={},d={},u=new WeakMap,f=[],p=null,m=!1,h=null,g=null,_=null,v=null,E=null,S=null,T=null,M=new i.Q1f(0,0,0),x=0,R=!1,b=null,A=null,C=null,P=null,L=null,U=e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS),D=!1,w=e.getParameter(e.VERSION);-1!==w.indexOf("WebGL")?D=parseFloat(/^WebGL (\d)/.exec(w)[1])>=1:-1!==w.indexOf("OpenGL ES")&&(D=parseFloat(/^OpenGL ES (\d)/.exec(w)[1])>=2);let I=null,y={},N=e.getParameter(e.SCISSOR_BOX),F=e.getParameter(e.VIEWPORT),O=new i.IUQ().fromArray(N),B=new i.IUQ().fromArray(F);function createTexture(t,r,i,a){let n=new Uint8Array(4),o=e.createTexture();e.bindTexture(t,o),e.texParameteri(t,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(t,e.TEXTURE_MAG_FILTER,e.NEAREST);for(let o=0;o<i;o++)t===e.TEXTURE_3D||t===e.TEXTURE_2D_ARRAY?e.texImage3D(r,0,e.RGBA,1,1,a,0,e.RGBA,e.UNSIGNED_BYTE,n):e.texImage2D(r+o,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,n);return o}let G={};function enable(t){!0!==l[t]&&(e.enable(t),l[t]=!0)}function disable(t){!1!==l[t]&&(e.disable(t),l[t]=!1)}function bindFramebuffer(t,r){return d[t]!==r&&(e.bindFramebuffer(t,r),d[t]=r,t===e.DRAW_FRAMEBUFFER&&(d[e.FRAMEBUFFER]=r),t===e.FRAMEBUFFER&&(d[e.DRAW_FRAMEBUFFER]=r),!0)}function drawBuffers(t,r){let i=f,a=!1;if(t){void 0===(i=u.get(r))&&(i=[],u.set(r,i));let n=t.textures;if(i.length!==n.length||i[0]!==e.COLOR_ATTACHMENT0){for(let t=0,r=n.length;t<r;t++)i[t]=e.COLOR_ATTACHMENT0+t;i.length=n.length,a=!0}}else i[0]!==e.BACK&&(i[0]=e.BACK,a=!0);a&&e.drawBuffers(i)}function useProgram(t){return p!==t&&(e.useProgram(t),p=t,!0)}G[e.TEXTURE_2D]=createTexture(e.TEXTURE_2D,e.TEXTURE_2D,1),G[e.TEXTURE_CUBE_MAP]=createTexture(e.TEXTURE_CUBE_MAP,e.TEXTURE_CUBE_MAP_POSITIVE_X,6),G[e.TEXTURE_2D_ARRAY]=createTexture(e.TEXTURE_2D_ARRAY,e.TEXTURE_2D_ARRAY,1,1),G[e.TEXTURE_3D]=createTexture(e.TEXTURE_3D,e.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),n.setClear(0),enable(e.DEPTH_TEST),a.setFunc(3),setFlipSided(!1),setCullFace(1),enable(e.CULL_FACE),setBlending(0);let V={100:e.FUNC_ADD,101:e.FUNC_SUBTRACT,102:e.FUNC_REVERSE_SUBTRACT};V[103]=e.MIN,V[104]=e.MAX;let H={200:e.ZERO,201:e.ONE,202:e.SRC_COLOR,204:e.SRC_ALPHA,210:e.SRC_ALPHA_SATURATE,208:e.DST_COLOR,206:e.DST_ALPHA,203:e.ONE_MINUS_SRC_COLOR,205:e.ONE_MINUS_SRC_ALPHA,209:e.ONE_MINUS_DST_COLOR,207:e.ONE_MINUS_DST_ALPHA,211:e.CONSTANT_COLOR,212:e.ONE_MINUS_CONSTANT_COLOR,213:e.CONSTANT_ALPHA,214:e.ONE_MINUS_CONSTANT_ALPHA};function setBlending(t,r,a,n,o,s,l,c,d,u){if(0===t){!0===m&&(disable(e.BLEND),m=!1);return}if(!1===m&&(enable(e.BLEND),m=!0),5!==t){if(t!==h||u!==R){if((100!==g||100!==E)&&(e.blendEquation(e.FUNC_ADD),g=100,E=100),u)switch(t){case 1:e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFunc(e.ONE,e.ONE);break;case 3:e.blendFuncSeparate(e.ZERO,e.ONE_MINUS_SRC_COLOR,e.ZERO,e.ONE);break;case 4:e.blendFuncSeparate(e.DST_COLOR,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE);break;default:(0,i.z3S)("WebGLState: Invalid blending: ",t)}else switch(t){case 1:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE,e.ONE,e.ONE);break;case 3:(0,i.z3S)("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case 4:(0,i.z3S)("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:(0,i.z3S)("WebGLState: Invalid blending: ",t)}_=null,v=null,S=null,T=null,M.set(0,0,0),x=0,h=t,R=u}return}o=o||r,s=s||a,l=l||n,(r!==g||o!==E)&&(e.blendEquationSeparate(V[r],V[o]),g=r,E=o),(a!==_||n!==v||s!==S||l!==T)&&(e.blendFuncSeparate(H[a],H[n],H[s],H[l]),_=a,v=n,S=s,T=l),(!1===c.equals(M)||d!==x)&&(e.blendColor(c.r,c.g,c.b,d),M.copy(c),x=d),h=t,R=!1}function setMaterial(t,i){2===t.side?disable(e.CULL_FACE):enable(e.CULL_FACE);let o=1===t.side;i&&(o=!o),setFlipSided(o),1===t.blending&&!1===t.transparent?setBlending(0):setBlending(t.blending,t.blendEquation,t.blendSrc,t.blendDst,t.blendEquationAlpha,t.blendSrcAlpha,t.blendDstAlpha,t.blendColor,t.blendAlpha,t.premultipliedAlpha),a.setFunc(t.depthFunc),a.setTest(t.depthTest),a.setMask(t.depthWrite),r.setMask(t.colorWrite);let s=t.stencilWrite;n.setTest(s),s&&(n.setMask(t.stencilWriteMask),n.setFunc(t.stencilFunc,t.stencilRef,t.stencilFuncMask),n.setOp(t.stencilFail,t.stencilZFail,t.stencilZPass)),setPolygonOffset(t.polygonOffset,t.polygonOffsetFactor,t.polygonOffsetUnits),!0===t.alphaToCoverage?enable(e.SAMPLE_ALPHA_TO_COVERAGE):disable(e.SAMPLE_ALPHA_TO_COVERAGE)}function setFlipSided(t){b!==t&&(t?e.frontFace(e.CW):e.frontFace(e.CCW),b=t)}function setCullFace(t){0!==t?(enable(e.CULL_FACE),t!==A&&(1===t?e.cullFace(e.BACK):2===t?e.cullFace(e.FRONT):e.cullFace(e.FRONT_AND_BACK))):disable(e.CULL_FACE),A=t}function setPolygonOffset(t,r,i){t?(enable(e.POLYGON_OFFSET_FILL),(P!==r||L!==i)&&(P=r,L=i,a.getReversed()&&(r=-r),e.polygonOffset(r,i))):disable(e.POLYGON_OFFSET_FILL)}function setScissorTest(t){t?enable(e.SCISSOR_TEST):disable(e.SCISSOR_TEST)}function reset(){e.disable(e.BLEND),e.disable(e.CULL_FACE),e.disable(e.DEPTH_TEST),e.disable(e.POLYGON_OFFSET_FILL),e.disable(e.SCISSOR_TEST),e.disable(e.STENCIL_TEST),e.disable(e.SAMPLE_ALPHA_TO_COVERAGE),e.blendEquation(e.FUNC_ADD),e.blendFunc(e.ONE,e.ZERO),e.blendFuncSeparate(e.ONE,e.ZERO,e.ONE,e.ZERO),e.blendColor(0,0,0,0),e.colorMask(!0,!0,!0,!0),e.clearColor(0,0,0,0),e.depthMask(!0),e.depthFunc(e.LESS),a.setReversed(!1),e.clearDepth(1),e.stencilMask(0xffffffff),e.stencilFunc(e.ALWAYS,0,0xffffffff),e.stencilOp(e.KEEP,e.KEEP,e.KEEP),e.clearStencil(0),e.cullFace(e.BACK),e.frontFace(e.CCW),e.polygonOffset(0,0),e.activeTexture(e.TEXTURE0),e.bindFramebuffer(e.FRAMEBUFFER,null),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),e.bindFramebuffer(e.READ_FRAMEBUFFER,null),e.useProgram(null),e.lineWidth(1),e.scissor(0,0,e.canvas.width,e.canvas.height),e.viewport(0,0,e.canvas.width,e.canvas.height),e.pixelStorei(e.PACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,e.BROWSER_DEFAULT_WEBGL),e.pixelStorei(e.PACK_ROW_LENGTH,0),e.pixelStorei(e.PACK_SKIP_PIXELS,0),e.pixelStorei(e.PACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_ROW_LENGTH,0),e.pixelStorei(e.UNPACK_IMAGE_HEIGHT,0),e.pixelStorei(e.UNPACK_SKIP_PIXELS,0),e.pixelStorei(e.UNPACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_SKIP_IMAGES,0),l={},c={},I=null,y={},d={},u=new WeakMap,f=[],p=null,m=!1,h=null,g=null,_=null,v=null,E=null,S=null,T=null,M=new i.Q1f(0,0,0),x=0,R=!1,b=null,A=null,C=null,P=null,L=null,O.set(0,0,e.canvas.width,e.canvas.height),B.set(0,0,e.canvas.width,e.canvas.height),r.reset(),a.reset(),n.reset()}return{buffers:{color:r,depth:a,stencil:n},enable:enable,disable:disable,bindFramebuffer:bindFramebuffer,drawBuffers:drawBuffers,useProgram:useProgram,setBlending:setBlending,setMaterial:setMaterial,setFlipSided:setFlipSided,setCullFace:setCullFace,setLineWidth:function(t){t!==C&&(D&&e.lineWidth(t),C=t)},setPolygonOffset:setPolygonOffset,setScissorTest:setScissorTest,activeTexture:function(t){void 0===t&&(t=e.TEXTURE0+U-1),I!==t&&(e.activeTexture(t),I=t)},bindTexture:function(t,r,i){void 0===i&&(i=null===I?e.TEXTURE0+U-1:I);let a=y[i];void 0===a&&(a={type:void 0,texture:void 0},y[i]=a),(a.type!==t||a.texture!==r)&&(I!==i&&(e.activeTexture(i),I=i),e.bindTexture(t,r||G[t]),a.type=t,a.texture=r)},unbindTexture:function(){let t=y[I];void 0!==t&&void 0!==t.type&&(e.bindTexture(t.type,null),t.type=void 0,t.texture=void 0)},compressedTexImage2D:function(){try{e.compressedTexImage2D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},compressedTexImage3D:function(){try{e.compressedTexImage3D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},texImage2D:function(){try{e.texImage2D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},texImage3D:function(){try{e.texImage3D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},pixelStorei:function(t,r){c[t]!==r&&(e.pixelStorei(t,r),c[t]=r)},getParameter:function(t){return void 0!==c[t]?c[t]:e.getParameter(t)},updateUBOMapping:function(t,r){let i=s.get(r);void 0===i&&(i=new WeakMap,s.set(r,i));let a=i.get(t);void 0===a&&(a=e.getUniformBlockIndex(r,t.name),i.set(t,a))},uniformBlockBinding:function(t,r){let i=s.get(r).get(t);o.get(r)!==i&&(e.uniformBlockBinding(r,i,t.__bindingPointIndex),o.set(r,i))},texStorage2D:function(){try{e.texStorage2D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},texStorage3D:function(){try{e.texStorage3D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},texSubImage2D:function(){try{e.texSubImage2D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},texSubImage3D:function(){try{e.texSubImage3D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},compressedTexSubImage2D:function(){try{e.compressedTexSubImage2D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},compressedTexSubImage3D:function(){try{e.compressedTexSubImage3D(...arguments)}catch(e){(0,i.z3S)("WebGLState:",e)}},scissor:function(t){!1===O.equals(t)&&(e.scissor(t.x,t.y,t.z,t.w),O.copy(t))},viewport:function(t){!1===B.equals(t)&&(e.viewport(t.x,t.y,t.z,t.w),B.copy(t))},reset:reset}}function WebGLTextures(e,t,r,a,n,o,s){let l,c=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,d="u">typeof navigator&&/OculusBrowser/g.test(navigator.userAgent),u=new i.I9Y,f=new WeakMap,p=new Set,m=new WeakMap,h=!1;try{h="u">typeof OffscreenCanvas&&null!==new OffscreenCanvas(1,1).getContext("2d")}catch{}function createCanvas(e,t){return h?new OffscreenCanvas(e,t):(0,i.qq$)("canvas")}function resizeImage(e,t,r){let a=1,n=getDimensions(e);if((n.width>r||n.height>r)&&(a=r/Math.max(n.width,n.height)),a<1)if("u">typeof HTMLImageElement&&e instanceof HTMLImageElement||"u">typeof HTMLCanvasElement&&e instanceof HTMLCanvasElement||"u">typeof ImageBitmap&&e instanceof ImageBitmap||"u">typeof VideoFrame&&e instanceof VideoFrame){let r=Math.floor(a*n.width),o=Math.floor(a*n.height);void 0===l&&(l=createCanvas(r,o));let s=t?createCanvas(r,o):l;return s.width=r,s.height=o,s.getContext("2d").drawImage(e,0,0,r,o),(0,i.R8M)("WebGLRenderer: Texture has been resized from ("+n.width+"x"+n.height+") to ("+r+"x"+o+")."),s}else"data"in e&&(0,i.R8M)("WebGLRenderer: Image in DataTexture is too big ("+n.width+"x"+n.height+").");return e}function textureNeedsGenerateMipmaps(e){return e.generateMipmaps}function generateMipmap(t){e.generateMipmap(t)}function getTargetType(t){return t.isWebGLCubeRenderTarget?e.TEXTURE_CUBE_MAP:t.isWebGL3DRenderTarget?e.TEXTURE_3D:t.isWebGLArrayRenderTarget||t.isCompressedArrayTexture?e.TEXTURE_2D_ARRAY:e.TEXTURE_2D}function getInternalFormat(r,a,n,o,s){let l,c=arguments.length>5&&void 0!==arguments[5]&&arguments[5];if(null!==r){if(void 0!==e[r])return e[r];(0,i.R8M)("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+r+"'")}o&&((l=t.get("EXT_texture_norm16"))||(0,i.R8M)("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let d=a;if(a===e.RED&&(n===e.FLOAT&&(d=e.R32F),n===e.HALF_FLOAT&&(d=e.R16F),n===e.UNSIGNED_BYTE&&(d=e.R8),n===e.UNSIGNED_SHORT&&l&&(d=l.R16_EXT),n===e.SHORT&&l&&(d=l.R16_SNORM_EXT)),a===e.RED_INTEGER&&(n===e.UNSIGNED_BYTE&&(d=e.R8UI),n===e.UNSIGNED_SHORT&&(d=e.R16UI),n===e.UNSIGNED_INT&&(d=e.R32UI),n===e.BYTE&&(d=e.R8I),n===e.SHORT&&(d=e.R16I),n===e.INT&&(d=e.R32I)),a===e.RG&&(n===e.FLOAT&&(d=e.RG32F),n===e.HALF_FLOAT&&(d=e.RG16F),n===e.UNSIGNED_BYTE&&(d=e.RG8),n===e.UNSIGNED_SHORT&&l&&(d=l.RG16_EXT),n===e.SHORT&&l&&(d=l.RG16_SNORM_EXT)),a===e.RG_INTEGER&&(n===e.UNSIGNED_BYTE&&(d=e.RG8UI),n===e.UNSIGNED_SHORT&&(d=e.RG16UI),n===e.UNSIGNED_INT&&(d=e.RG32UI),n===e.BYTE&&(d=e.RG8I),n===e.SHORT&&(d=e.RG16I),n===e.INT&&(d=e.RG32I)),a===e.RGB_INTEGER&&(n===e.UNSIGNED_BYTE&&(d=e.RGB8UI),n===e.UNSIGNED_SHORT&&(d=e.RGB16UI),n===e.UNSIGNED_INT&&(d=e.RGB32UI),n===e.BYTE&&(d=e.RGB8I),n===e.SHORT&&(d=e.RGB16I),n===e.INT&&(d=e.RGB32I)),a===e.RGBA_INTEGER&&(n===e.UNSIGNED_BYTE&&(d=e.RGBA8UI),n===e.UNSIGNED_SHORT&&(d=e.RGBA16UI),n===e.UNSIGNED_INT&&(d=e.RGBA32UI),n===e.BYTE&&(d=e.RGBA8I),n===e.SHORT&&(d=e.RGBA16I),n===e.INT&&(d=e.RGBA32I)),a===e.RGB&&(n===e.UNSIGNED_SHORT&&l&&(d=l.RGB16_EXT),n===e.SHORT&&l&&(d=l.RGB16_SNORM_EXT),n===e.UNSIGNED_INT_5_9_9_9_REV&&(d=e.RGB9_E5),n===e.UNSIGNED_INT_10F_11F_11F_REV&&(d=e.R11F_G11F_B10F)),a===e.RGBA){let t=c?"linear":i.ppV.getTransfer(s);n===e.FLOAT&&(d=e.RGBA32F),n===e.HALF_FLOAT&&(d=e.RGBA16F),n===e.UNSIGNED_BYTE&&(d="srgb"===t?e.SRGB8_ALPHA8:e.RGBA8),n===e.UNSIGNED_SHORT&&l&&(d=l.RGBA16_EXT),n===e.SHORT&&l&&(d=l.RGBA16_SNORM_EXT),n===e.UNSIGNED_SHORT_4_4_4_4&&(d=e.RGBA4),n===e.UNSIGNED_SHORT_5_5_5_1&&(d=e.RGB5_A1)}return(d===e.R16F||d===e.R32F||d===e.RG16F||d===e.RG32F||d===e.RGBA16F||d===e.RGBA32F)&&t.get("EXT_color_buffer_float"),d}function getInternalDepthFormat(t,r){let a;return t?null===r||1014===r||1020===r?a=e.DEPTH24_STENCIL8:1015===r?a=e.DEPTH32F_STENCIL8:1012===r&&(a=e.DEPTH24_STENCIL8,(0,i.R8M)("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):null===r||1014===r||1020===r?a=e.DEPTH_COMPONENT24:1015===r?a=e.DEPTH_COMPONENT32F:1012===r&&(a=e.DEPTH_COMPONENT16),a}function getMipLevels(e,t){return!0===textureNeedsGenerateMipmaps(e)||e.isFramebufferTexture&&1003!==e.minFilter&&1006!==e.minFilter?Math.log2(Math.max(t.width,t.height))+1:void 0!==e.mipmaps&&e.mipmaps.length>0?e.mipmaps.length:e.isCompressedTexture&&Array.isArray(e.image)?t.mipmaps.length:1}function onTextureDispose(e){let t=e.target;t.removeEventListener("dispose",onTextureDispose),deallocateTexture(t),t.isVideoTexture&&f.delete(t),t.isHTMLTexture&&p.delete(t)}function onRenderTargetDispose(e){let t=e.target;t.removeEventListener("dispose",onRenderTargetDispose),deallocateRenderTarget(t)}function deallocateTexture(e){let t=a.get(e);if(void 0===t.__webglInit)return;let r=e.source,i=m.get(r);if(i){let a=i[t.__cacheKey];a.usedTimes--,0===a.usedTimes&&deleteTexture(e),0===Object.keys(i).length&&m.delete(r)}a.remove(e)}function deleteTexture(t){let r=a.get(t);e.deleteTexture(r.__webglTexture);let i=t.source,n=m.get(i);delete n[r.__cacheKey],s.memory.textures--}function deallocateRenderTarget(t){let r=a.get(t);if(t.depthTexture&&(t.depthTexture.dispose(),a.remove(t.depthTexture)),t.isWebGLCubeRenderTarget)for(let t=0;t<6;t++){if(Array.isArray(r.__webglFramebuffer[t]))for(let i=0;i<r.__webglFramebuffer[t].length;i++)e.deleteFramebuffer(r.__webglFramebuffer[t][i]);else e.deleteFramebuffer(r.__webglFramebuffer[t]);r.__webglDepthbuffer&&e.deleteRenderbuffer(r.__webglDepthbuffer[t])}else{if(Array.isArray(r.__webglFramebuffer))for(let t=0;t<r.__webglFramebuffer.length;t++)e.deleteFramebuffer(r.__webglFramebuffer[t]);else e.deleteFramebuffer(r.__webglFramebuffer);if(r.__webglDepthbuffer&&e.deleteRenderbuffer(r.__webglDepthbuffer),r.__webglMultisampledFramebuffer&&e.deleteFramebuffer(r.__webglMultisampledFramebuffer),r.__webglColorRenderbuffer)for(let t=0;t<r.__webglColorRenderbuffer.length;t++)r.__webglColorRenderbuffer[t]&&e.deleteRenderbuffer(r.__webglColorRenderbuffer[t]);r.__webglDepthRenderbuffer&&e.deleteRenderbuffer(r.__webglDepthRenderbuffer)}let i=t.textures;for(let t=0,r=i.length;t<r;t++){let r=a.get(i[t]);r.__webglTexture&&(e.deleteTexture(r.__webglTexture),s.memory.textures--),a.remove(i[t])}a.remove(t)}let g=0;function resetTextureUnits(){g=0}function getTextureUnits(){return g}function setTextureUnits(e){g=e}function allocateTextureUnit(){let e=g;return e>=n.maxTextures&&(0,i.R8M)("WebGLTextures: Trying to use "+e+" texture units while this GPU supports only "+n.maxTextures),g+=1,e}function getTextureCacheKey(e){let t=[];return t.push(e.wrapS),t.push(e.wrapT),t.push(e.wrapR||0),t.push(e.magFilter),t.push(e.minFilter),t.push(e.anisotropy),t.push(e.internalFormat),t.push(e.format),t.push(e.type),t.push(e.generateMipmaps),t.push(e.premultiplyAlpha),t.push(e.flipY),t.push(e.unpackAlignment),t.push(e.colorSpace),t.join()}function setTexture2D(t,n){let o=a.get(t);if(t.isVideoTexture&&updateVideoTexture(t),!1===t.isRenderTargetTexture&&!0!==t.isExternalTexture&&t.version>0&&o.__version!==t.version){let e=t.image;if(null===e)(0,i.R8M)("WebGLRenderer: Texture marked for update but no image data found.");else{if(!1!==e.complete)return void uploadTexture(o,t,n);(0,i.R8M)("WebGLRenderer: Texture marked for update but image is incomplete")}}else t.isExternalTexture&&(o.__webglTexture=t.sourceTexture?t.sourceTexture:null);r.bindTexture(e.TEXTURE_2D,o.__webglTexture,e.TEXTURE0+n)}function setTexture2DArray(t,i){let n=a.get(t);!1===t.isRenderTargetTexture&&t.version>0&&n.__version!==t.version?uploadTexture(n,t,i):(t.isExternalTexture&&(n.__webglTexture=t.sourceTexture?t.sourceTexture:null),r.bindTexture(e.TEXTURE_2D_ARRAY,n.__webglTexture,e.TEXTURE0+i))}function setTexture3D(t,i){let n=a.get(t);!1===t.isRenderTargetTexture&&t.version>0&&n.__version!==t.version?uploadTexture(n,t,i):r.bindTexture(e.TEXTURE_3D,n.__webglTexture,e.TEXTURE0+i)}function setTextureCube(t,i){let n=a.get(t);!0!==t.isCubeDepthTexture&&t.version>0&&n.__version!==t.version?uploadCubeTexture(n,t,i):r.bindTexture(e.TEXTURE_CUBE_MAP,n.__webglTexture,e.TEXTURE0+i)}let _={1e3:e.REPEAT,1001:e.CLAMP_TO_EDGE,1002:e.MIRRORED_REPEAT},v={1003:e.NEAREST,1004:e.NEAREST_MIPMAP_NEAREST,1005:e.NEAREST_MIPMAP_LINEAR,1006:e.LINEAR,1007:e.LINEAR_MIPMAP_NEAREST,1008:e.LINEAR_MIPMAP_LINEAR},E={512:e.NEVER,519:e.ALWAYS,513:e.LESS,515:e.LEQUAL,514:e.EQUAL,518:e.GEQUAL,516:e.GREATER,517:e.NOTEQUAL};function setTextureParameters(r,o){if((1015===o.type&&!1===t.has("OES_texture_float_linear")&&(1006===o.magFilter||1007===o.magFilter||1005===o.magFilter||1008===o.magFilter||1006===o.minFilter||1007===o.minFilter||1005===o.minFilter||1008===o.minFilter)&&(0,i.R8M)("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),e.texParameteri(r,e.TEXTURE_WRAP_S,_[o.wrapS]),e.texParameteri(r,e.TEXTURE_WRAP_T,_[o.wrapT]),(r===e.TEXTURE_3D||r===e.TEXTURE_2D_ARRAY)&&e.texParameteri(r,e.TEXTURE_WRAP_R,_[o.wrapR]),e.texParameteri(r,e.TEXTURE_MAG_FILTER,v[o.magFilter]),e.texParameteri(r,e.TEXTURE_MIN_FILTER,v[o.minFilter]),o.compareFunction&&(e.texParameteri(r,e.TEXTURE_COMPARE_MODE,e.COMPARE_REF_TO_TEXTURE),e.texParameteri(r,e.TEXTURE_COMPARE_FUNC,E[o.compareFunction])),!0===t.has("EXT_texture_filter_anisotropic"))&&1003!==o.magFilter&&(1005===o.minFilter||1008===o.minFilter)&&(1015!==o.type||!1!==t.has("OES_texture_float_linear"))&&(o.anisotropy>1||a.get(o).__currentAnisotropy)){let i=t.get("EXT_texture_filter_anisotropic");e.texParameterf(r,i.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(o.anisotropy,n.getMaxAnisotropy())),a.get(o).__currentAnisotropy=o.anisotropy}}function initTexture(t,r){let i=!1;void 0===t.__webglInit&&(t.__webglInit=!0,r.addEventListener("dispose",onTextureDispose));let a=r.source,n=m.get(a);void 0===n&&(n={},m.set(a,n));let o=getTextureCacheKey(r);if(o!==t.__cacheKey){void 0===n[o]&&(n[o]={texture:e.createTexture(),usedTimes:0},s.memory.textures++,i=!0),n[o].usedTimes++;let a=n[t.__cacheKey];void 0!==a&&(n[t.__cacheKey].usedTimes--,0===a.usedTimes&&deleteTexture(r)),t.__cacheKey=o,t.__webglTexture=n[o].texture}return i}function getRow(e,t,r){return Math.floor(Math.floor(e/r)/t)}function updateTexture(t,i,a,n){let o=t.updateRanges;if(0===o.length)r.texSubImage2D(e.TEXTURE_2D,0,0,0,i.width,i.height,a,n,i.data);else{o.sort((e,t)=>e.start-t.start);let s=0;for(let e=1;e<o.length;e++){let t=o[s],r=o[e],a=t.start+t.count,n=getRow(r.start,i.width,4),l=getRow(t.start,i.width,4);r.start<=a+1&&n===l&&getRow(r.start+r.count-1,i.width,4)===n?t.count=Math.max(t.count,r.start+r.count-t.start):o[++s]=r}o.length=s+1;let l=r.getParameter(e.UNPACK_ROW_LENGTH),c=r.getParameter(e.UNPACK_SKIP_PIXELS),d=r.getParameter(e.UNPACK_SKIP_ROWS);r.pixelStorei(e.UNPACK_ROW_LENGTH,i.width);for(let t=0,s=o.length;t<s;t++){let s=o[t],l=Math.floor(s.start/4),c=Math.ceil(s.count/4),d=l%i.width,u=Math.floor(l/i.width);r.pixelStorei(e.UNPACK_SKIP_PIXELS,d),r.pixelStorei(e.UNPACK_SKIP_ROWS,u),r.texSubImage2D(e.TEXTURE_2D,0,d,u,c,1,a,n,i.data)}t.clearUpdateRanges(),r.pixelStorei(e.UNPACK_ROW_LENGTH,l),r.pixelStorei(e.UNPACK_SKIP_PIXELS,c),r.pixelStorei(e.UNPACK_SKIP_ROWS,d)}}function uploadTexture(t,s,l){let c=e.TEXTURE_2D;(s.isDataArrayTexture||s.isCompressedArrayTexture)&&(c=e.TEXTURE_2D_ARRAY),s.isData3DTexture&&(c=e.TEXTURE_3D);let d=initTexture(t,s),u=s.source;r.bindTexture(c,t.__webglTexture,e.TEXTURE0+l);let f=a.get(u);if(u.version!==f.__version||!0===d){let t;if(r.activeTexture(e.TEXTURE0+l),!1==("u">typeof ImageBitmap&&s.image instanceof ImageBitmap)){let t=i.ppV.getPrimaries(i.ppV.workingColorSpace),a=""===s.colorSpace?null:i.ppV.getPrimaries(s.colorSpace),n=""===s.colorSpace||t===a?e.NONE:e.BROWSER_DEFAULT_WEBGL;r.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,s.flipY),r.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,s.premultiplyAlpha),r.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,n)}r.pixelStorei(e.UNPACK_ALIGNMENT,s.unpackAlignment);let a=resizeImage(s.image,!1,n.maxTextureSize);a=verifyColorSpace(s,a);let m=o.convert(s.format,s.colorSpace),h=o.convert(s.type),g=getInternalFormat(s.internalFormat,m,h,s.normalized,s.colorSpace,s.isVideoTexture);setTextureParameters(c,s);let _=s.mipmaps,v=!0!==s.isVideoTexture,E=void 0===f.__version||!0===d,S=u.dataReady,T=getMipLevels(s,a);if(s.isDepthTexture)g=getInternalDepthFormat(1027===s.format,s.type),E&&(v?r.texStorage2D(e.TEXTURE_2D,1,g,a.width,a.height):r.texImage2D(e.TEXTURE_2D,0,g,a.width,a.height,0,m,h,null));else if(s.isDataTexture)if(_.length>0){v&&E&&r.texStorage2D(e.TEXTURE_2D,T,g,_[0].width,_[0].height);for(let i=0,a=_.length;i<a;i++)t=_[i],v?S&&r.texSubImage2D(e.TEXTURE_2D,i,0,0,t.width,t.height,m,h,t.data):r.texImage2D(e.TEXTURE_2D,i,g,t.width,t.height,0,m,h,t.data);s.generateMipmaps=!1}else v?(E&&r.texStorage2D(e.TEXTURE_2D,T,g,a.width,a.height),S&&updateTexture(s,a,m,h)):r.texImage2D(e.TEXTURE_2D,0,g,a.width,a.height,0,m,h,a.data);else if(s.isCompressedTexture)if(s.isCompressedArrayTexture){v&&E&&r.texStorage3D(e.TEXTURE_2D_ARRAY,T,g,_[0].width,_[0].height,a.depth);for(let n=0,o=_.length;n<o;n++)if(t=_[n],1023!==s.format)if(null!==m)if(v){if(S)if(s.layerUpdates.size>0){let a=(0,i.Nex)(t.width,t.height,s.format,s.type);for(let i of s.layerUpdates){let o=t.data.subarray(i*a/t.data.BYTES_PER_ELEMENT,(i+1)*a/t.data.BYTES_PER_ELEMENT);r.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,n,0,0,i,t.width,t.height,1,m,o)}s.clearLayerUpdates()}else r.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,n,0,0,0,t.width,t.height,a.depth,m,t.data)}else r.compressedTexImage3D(e.TEXTURE_2D_ARRAY,n,g,t.width,t.height,a.depth,0,t.data,0,0);else(0,i.R8M)("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else v?S&&r.texSubImage3D(e.TEXTURE_2D_ARRAY,n,0,0,0,t.width,t.height,a.depth,m,h,t.data):r.texImage3D(e.TEXTURE_2D_ARRAY,n,g,t.width,t.height,a.depth,0,m,h,t.data)}else{v&&E&&r.texStorage2D(e.TEXTURE_2D,T,g,_[0].width,_[0].height);for(let a=0,n=_.length;a<n;a++)t=_[a],1023!==s.format?null!==m?v?S&&r.compressedTexSubImage2D(e.TEXTURE_2D,a,0,0,t.width,t.height,m,t.data):r.compressedTexImage2D(e.TEXTURE_2D,a,g,t.width,t.height,0,t.data):(0,i.R8M)("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):v?S&&r.texSubImage2D(e.TEXTURE_2D,a,0,0,t.width,t.height,m,h,t.data):r.texImage2D(e.TEXTURE_2D,a,g,t.width,t.height,0,m,h,t.data)}else if(s.isDataArrayTexture)if(v){if(E&&r.texStorage3D(e.TEXTURE_2D_ARRAY,T,g,a.width,a.height,a.depth),S)if(s.layerUpdates.size>0){let t=(0,i.Nex)(a.width,a.height,s.format,s.type);for(let i of s.layerUpdates){let n=a.data.subarray(i*t/a.data.BYTES_PER_ELEMENT,(i+1)*t/a.data.BYTES_PER_ELEMENT);r.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,i,a.width,a.height,1,m,h,n)}s.clearLayerUpdates()}else r.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,0,a.width,a.height,a.depth,m,h,a.data)}else r.texImage3D(e.TEXTURE_2D_ARRAY,0,g,a.width,a.height,a.depth,0,m,h,a.data);else if(s.isData3DTexture)v?(E&&r.texStorage3D(e.TEXTURE_3D,T,g,a.width,a.height,a.depth),S&&r.texSubImage3D(e.TEXTURE_3D,0,0,0,0,a.width,a.height,a.depth,m,h,a.data)):r.texImage3D(e.TEXTURE_3D,0,g,a.width,a.height,a.depth,0,m,h,a.data);else if(s.isFramebufferTexture){if(E)if(v)r.texStorage2D(e.TEXTURE_2D,T,g,a.width,a.height);else{let t=a.width,i=a.height;for(let a=0;a<T;a++)r.texImage2D(e.TEXTURE_2D,a,g,t,i,0,m,h,null),t>>=1,i>>=1}}else if(s.isHTMLTexture){if("texElementImage2D"in e){let t=e.canvas;if(t.hasAttribute("layoutsubtree")||t.setAttribute("layoutsubtree","true"),a.parentNode!==t){t.appendChild(a),p.add(s),t.onpaint=e=>{let t=e.changedElements;for(let e of p)t.includes(e.image)&&(e.needsUpdate=!0)},t.requestPaint();return}if(3===e.texElementImage2D.length)e.texElementImage2D(e.TEXTURE_2D,e.RGBA8,a);else{let t=e.RGBA,r=e.RGBA,i=e.UNSIGNED_BYTE;e.texElementImage2D(e.TEXTURE_2D,0,t,r,i,a)}e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}}else if(_.length>0){if(v&&E){let t=getDimensions(_[0]);r.texStorage2D(e.TEXTURE_2D,T,g,t.width,t.height)}for(let i=0,a=_.length;i<a;i++)t=_[i],v?S&&r.texSubImage2D(e.TEXTURE_2D,i,0,0,m,h,t):r.texImage2D(e.TEXTURE_2D,i,g,m,h,t);s.generateMipmaps=!1}else if(v){if(E){let t=getDimensions(a);r.texStorage2D(e.TEXTURE_2D,T,g,t.width,t.height)}S&&r.texSubImage2D(e.TEXTURE_2D,0,0,0,m,h,a)}else r.texImage2D(e.TEXTURE_2D,0,g,m,h,a);textureNeedsGenerateMipmaps(s)&&generateMipmap(c),f.__version=u.version,s.onUpdate&&s.onUpdate(s)}t.__version=s.version}function uploadCubeTexture(t,s,l){if(6!==s.image.length)return;let c=initTexture(t,s),d=s.source;r.bindTexture(e.TEXTURE_CUBE_MAP,t.__webglTexture,e.TEXTURE0+l);let u=a.get(d);if(d.version!==u.__version||!0===c){let t;r.activeTexture(e.TEXTURE0+l);let a=i.ppV.getPrimaries(i.ppV.workingColorSpace),f=""===s.colorSpace?null:i.ppV.getPrimaries(s.colorSpace),p=""===s.colorSpace||a===f?e.NONE:e.BROWSER_DEFAULT_WEBGL;r.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,s.flipY),r.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,s.premultiplyAlpha),r.pixelStorei(e.UNPACK_ALIGNMENT,s.unpackAlignment),r.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,p);let m=s.isCompressedTexture||s.image[0].isCompressedTexture,h=s.image[0]&&s.image[0].isDataTexture,g=[];for(let e=0;e<6;e++)m||h?g[e]=h?s.image[e].image:s.image[e]:g[e]=resizeImage(s.image[e],!0,n.maxCubemapSize),g[e]=verifyColorSpace(s,g[e]);let _=g[0],v=o.convert(s.format,s.colorSpace),E=o.convert(s.type),S=getInternalFormat(s.internalFormat,v,E,s.normalized,s.colorSpace),T=!0!==s.isVideoTexture,M=void 0===u.__version||!0===c,x=d.dataReady,R=getMipLevels(s,_);if(setTextureParameters(e.TEXTURE_CUBE_MAP,s),m){T&&M&&r.texStorage2D(e.TEXTURE_CUBE_MAP,R,S,_.width,_.height);for(let a=0;a<6;a++){t=g[a].mipmaps;for(let n=0;n<t.length;n++){let o=t[n];1023!==s.format?null!==v?T?x&&r.compressedTexSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+a,n,0,0,o.width,o.height,v,o.data):r.compressedTexImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+a,n,S,o.width,o.height,0,o.data):(0,i.R8M)("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):T?x&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+a,n,0,0,o.width,o.height,v,E,o.data):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+a,n,S,o.width,o.height,0,v,E,o.data)}}}else{if(t=s.mipmaps,T&&M){t.length>0&&R++;let i=getDimensions(g[0]);r.texStorage2D(e.TEXTURE_CUBE_MAP,R,S,i.width,i.height)}for(let i=0;i<6;i++)if(h){T?x&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,0,0,g[i].width,g[i].height,v,E,g[i].data):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,S,g[i].width,g[i].height,0,v,E,g[i].data);for(let a=0;a<t.length;a++){let n=t[a].image[i].image;T?x&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+i,a+1,0,0,n.width,n.height,v,E,n.data):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+i,a+1,S,n.width,n.height,0,v,E,n.data)}}else{T?x&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,0,0,v,E,g[i]):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,S,v,E,g[i]);for(let a=0;a<t.length;a++){let n=t[a];T?x&&r.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+i,a+1,0,0,v,E,n.image[i]):r.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+i,a+1,S,v,E,n.image[i])}}}textureNeedsGenerateMipmaps(s)&&generateMipmap(e.TEXTURE_CUBE_MAP),u.__version=d.version,s.onUpdate&&s.onUpdate(s)}t.__version=s.version}function setupFrameBufferTexture(t,i,n,s,l,d){let u=o.convert(n.format,n.colorSpace),f=o.convert(n.type),p=getInternalFormat(n.internalFormat,u,f,n.normalized,n.colorSpace),m=a.get(i),h=a.get(n);if(h.__renderTarget=i,!m.__hasExternalTextures){let t=Math.max(1,i.width>>d),a=Math.max(1,i.height>>d);l===e.TEXTURE_3D||l===e.TEXTURE_2D_ARRAY?r.texImage3D(l,d,p,t,a,i.depth,0,u,f,null):r.texImage2D(l,d,p,t,a,0,u,f,null)}r.bindFramebuffer(e.FRAMEBUFFER,t),useMultisampledRTT(i)?c.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,s,l,h.__webglTexture,0,getRenderTargetSamples(i)):(l===e.TEXTURE_2D||l>=e.TEXTURE_CUBE_MAP_POSITIVE_X&&l<=e.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&e.framebufferTexture2D(e.FRAMEBUFFER,s,l,h.__webglTexture,d),r.bindFramebuffer(e.FRAMEBUFFER,null)}function setupRenderBufferStorage(t,r,i){if(e.bindRenderbuffer(e.RENDERBUFFER,t),r.depthBuffer){let a=r.depthTexture,n=a&&a.isDepthTexture?a.type:null,o=getInternalDepthFormat(r.stencilBuffer,n),s=r.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;useMultisampledRTT(r)?c.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,getRenderTargetSamples(r),o,r.width,r.height):i?e.renderbufferStorageMultisample(e.RENDERBUFFER,getRenderTargetSamples(r),o,r.width,r.height):e.renderbufferStorage(e.RENDERBUFFER,o,r.width,r.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,s,e.RENDERBUFFER,t)}else{let t=r.textures;for(let a=0;a<t.length;a++){let n=t[a],s=o.convert(n.format,n.colorSpace),l=o.convert(n.type),d=getInternalFormat(n.internalFormat,s,l,n.normalized,n.colorSpace);useMultisampledRTT(r)?c.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,getRenderTargetSamples(r),d,r.width,r.height):i?e.renderbufferStorageMultisample(e.RENDERBUFFER,getRenderTargetSamples(r),d,r.width,r.height):e.renderbufferStorage(e.RENDERBUFFER,d,r.width,r.height)}}e.bindRenderbuffer(e.RENDERBUFFER,null)}function setupDepthTexture(t,i,n){let s=!0===i.isWebGLCubeRenderTarget;if(r.bindFramebuffer(e.FRAMEBUFFER,t),!(i.depthTexture&&i.depthTexture.isDepthTexture))throw Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let l=a.get(i.depthTexture);if(l.__renderTarget=i,l.__webglTexture&&i.depthTexture.image.width===i.width&&i.depthTexture.image.height===i.height||(i.depthTexture.image.width=i.width,i.depthTexture.image.height=i.height,i.depthTexture.needsUpdate=!0),s){if(void 0===l.__webglInit&&(l.__webglInit=!0,i.depthTexture.addEventListener("dispose",onTextureDispose)),void 0===l.__webglTexture){let t;l.__webglTexture=e.createTexture(),r.bindTexture(e.TEXTURE_CUBE_MAP,l.__webglTexture),setTextureParameters(e.TEXTURE_CUBE_MAP,i.depthTexture);let a=o.convert(i.depthTexture.format),n=o.convert(i.depthTexture.type);1026===i.depthTexture.format?t=e.DEPTH_COMPONENT24:1027===i.depthTexture.format&&(t=e.DEPTH24_STENCIL8);for(let r=0;r<6;r++)e.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+r,0,t,i.width,i.height,0,a,n,null)}}else setTexture2D(i.depthTexture,0);let d=l.__webglTexture,u=getRenderTargetSamples(i),f=s?e.TEXTURE_CUBE_MAP_POSITIVE_X+n:e.TEXTURE_2D,p=1027===i.depthTexture.format?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;if(1026===i.depthTexture.format)useMultisampledRTT(i)?c.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,d,0,u):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,d,0);else if(1027===i.depthTexture.format)useMultisampledRTT(i)?c.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,d,0,u):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,d,0);else throw Error("THREE.WebGLTextures: Unknown depthTexture format.")}function setupDepthRenderbuffer(t){let i=a.get(t),n=!0===t.isWebGLCubeRenderTarget;if(i.__boundDepthTexture!==t.depthTexture){let e=t.depthTexture;if(i.__depthDisposeCallback&&i.__depthDisposeCallback(),e){let disposeEvent=()=>{delete i.__boundDepthTexture,delete i.__depthDisposeCallback,e.removeEventListener("dispose",disposeEvent)};e.addEventListener("dispose",disposeEvent),i.__depthDisposeCallback=disposeEvent}i.__boundDepthTexture=e}if(t.depthTexture&&!i.__autoAllocateDepthBuffer)if(n)for(let e=0;e<6;e++)setupDepthTexture(i.__webglFramebuffer[e],t,e);else{let e=t.texture.mipmaps;e&&e.length>0?setupDepthTexture(i.__webglFramebuffer[0],t,0):setupDepthTexture(i.__webglFramebuffer,t,0)}else if(n){i.__webglDepthbuffer=[];for(let a=0;a<6;a++)if(r.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[a]),void 0===i.__webglDepthbuffer[a])i.__webglDepthbuffer[a]=e.createRenderbuffer(),setupRenderBufferStorage(i.__webglDepthbuffer[a],t,!1);else{let r=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,n=i.__webglDepthbuffer[a];e.bindRenderbuffer(e.RENDERBUFFER,n),e.framebufferRenderbuffer(e.FRAMEBUFFER,r,e.RENDERBUFFER,n)}}else{let a=t.texture.mipmaps;if(a&&a.length>0?r.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[0]):r.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer),void 0===i.__webglDepthbuffer)i.__webglDepthbuffer=e.createRenderbuffer(),setupRenderBufferStorage(i.__webglDepthbuffer,t,!1);else{let r=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,a=i.__webglDepthbuffer;e.bindRenderbuffer(e.RENDERBUFFER,a),e.framebufferRenderbuffer(e.FRAMEBUFFER,r,e.RENDERBUFFER,a)}}r.bindFramebuffer(e.FRAMEBUFFER,null)}function rebindTextures(t,r,i){let n=a.get(t);void 0!==r&&setupFrameBufferTexture(n.__webglFramebuffer,t,t.texture,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,0),void 0!==i&&setupDepthRenderbuffer(t)}function setupRenderTarget(t){let i=t.texture,n=a.get(t),l=a.get(i);t.addEventListener("dispose",onRenderTargetDispose);let c=t.textures,d=!0===t.isWebGLCubeRenderTarget,u=c.length>1;if(!u&&(void 0===l.__webglTexture&&(l.__webglTexture=e.createTexture()),l.__version=i.version,s.memory.textures++),d){n.__webglFramebuffer=[];for(let t=0;t<6;t++)if(i.mipmaps&&i.mipmaps.length>0){n.__webglFramebuffer[t]=[];for(let r=0;r<i.mipmaps.length;r++)n.__webglFramebuffer[t][r]=e.createFramebuffer()}else n.__webglFramebuffer[t]=e.createFramebuffer()}else{if(i.mipmaps&&i.mipmaps.length>0){n.__webglFramebuffer=[];for(let t=0;t<i.mipmaps.length;t++)n.__webglFramebuffer[t]=e.createFramebuffer()}else n.__webglFramebuffer=e.createFramebuffer();if(u)for(let t=0,r=c.length;t<r;t++){let r=a.get(c[t]);void 0===r.__webglTexture&&(r.__webglTexture=e.createTexture(),s.memory.textures++)}if(t.samples>0&&!1===useMultisampledRTT(t)){n.__webglMultisampledFramebuffer=e.createFramebuffer(),n.__webglColorRenderbuffer=[],r.bindFramebuffer(e.FRAMEBUFFER,n.__webglMultisampledFramebuffer);for(let r=0;r<c.length;r++){let i=c[r];n.__webglColorRenderbuffer[r]=e.createRenderbuffer(),e.bindRenderbuffer(e.RENDERBUFFER,n.__webglColorRenderbuffer[r]);let a=o.convert(i.format,i.colorSpace),s=o.convert(i.type),l=getInternalFormat(i.internalFormat,a,s,i.normalized,i.colorSpace,!0===t.isXRRenderTarget),d=getRenderTargetSamples(t);e.renderbufferStorageMultisample(e.RENDERBUFFER,d,l,t.width,t.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+r,e.RENDERBUFFER,n.__webglColorRenderbuffer[r])}e.bindRenderbuffer(e.RENDERBUFFER,null),t.depthBuffer&&(n.__webglDepthRenderbuffer=e.createRenderbuffer(),setupRenderBufferStorage(n.__webglDepthRenderbuffer,t,!0)),r.bindFramebuffer(e.FRAMEBUFFER,null)}}if(d){r.bindTexture(e.TEXTURE_CUBE_MAP,l.__webglTexture),setTextureParameters(e.TEXTURE_CUBE_MAP,i);for(let r=0;r<6;r++)if(i.mipmaps&&i.mipmaps.length>0)for(let a=0;a<i.mipmaps.length;a++)setupFrameBufferTexture(n.__webglFramebuffer[r][a],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+r,a);else setupFrameBufferTexture(n.__webglFramebuffer[r],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+r,0);textureNeedsGenerateMipmaps(i)&&generateMipmap(e.TEXTURE_CUBE_MAP),r.unbindTexture()}else if(u){for(let i=0,o=c.length;i<o;i++){let o=c[i],s=a.get(o),l=e.TEXTURE_2D;(t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(l=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),r.bindTexture(l,s.__webglTexture),setTextureParameters(l,o),setupFrameBufferTexture(n.__webglFramebuffer,t,o,e.COLOR_ATTACHMENT0+i,l,0),textureNeedsGenerateMipmaps(o)&&generateMipmap(l)}r.unbindTexture()}else{let a=e.TEXTURE_2D;if((t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(a=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),r.bindTexture(a,l.__webglTexture),setTextureParameters(a,i),i.mipmaps&&i.mipmaps.length>0)for(let r=0;r<i.mipmaps.length;r++)setupFrameBufferTexture(n.__webglFramebuffer[r],t,i,e.COLOR_ATTACHMENT0,a,r);else setupFrameBufferTexture(n.__webglFramebuffer,t,i,e.COLOR_ATTACHMENT0,a,0);textureNeedsGenerateMipmaps(i)&&generateMipmap(a),r.unbindTexture()}t.depthBuffer&&setupDepthRenderbuffer(t)}function updateRenderTargetMipmap(e){let t=e.textures;for(let i=0,n=t.length;i<n;i++){let n=t[i];if(textureNeedsGenerateMipmaps(n)){let t=getTargetType(e),i=a.get(n).__webglTexture;r.bindTexture(t,i),generateMipmap(t),r.unbindTexture()}}}let S=[],T=[];function updateMultisampleRenderTarget(t){if(t.samples>0){if(!1===useMultisampledRTT(t)){let i=t.textures,n=t.width,o=t.height,s=e.COLOR_BUFFER_BIT,l=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,c=a.get(t),u=i.length>1;if(u)for(let t=0;t<i.length;t++)r.bindFramebuffer(e.FRAMEBUFFER,c.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,null),r.bindFramebuffer(e.FRAMEBUFFER,c.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,null,0);r.bindFramebuffer(e.READ_FRAMEBUFFER,c.__webglMultisampledFramebuffer);let f=t.texture.mipmaps;f&&f.length>0?r.bindFramebuffer(e.DRAW_FRAMEBUFFER,c.__webglFramebuffer[0]):r.bindFramebuffer(e.DRAW_FRAMEBUFFER,c.__webglFramebuffer);for(let r=0;r<i.length;r++){if(t.resolveDepthBuffer&&(t.depthBuffer&&(s|=e.DEPTH_BUFFER_BIT),t.stencilBuffer&&t.resolveStencilBuffer&&(s|=e.STENCIL_BUFFER_BIT)),u){e.framebufferRenderbuffer(e.READ_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,c.__webglColorRenderbuffer[r]);let t=a.get(i[r]).__webglTexture;e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t,0)}e.blitFramebuffer(0,0,n,o,0,0,n,o,s,e.NEAREST),!0===d&&(S.length=0,T.length=0,S.push(e.COLOR_ATTACHMENT0+r),t.depthBuffer&&!1===t.resolveDepthBuffer&&(S.push(l),T.push(l),e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,T)),e.invalidateFramebuffer(e.READ_FRAMEBUFFER,S))}if(r.bindFramebuffer(e.READ_FRAMEBUFFER,null),r.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),u)for(let t=0;t<i.length;t++){r.bindFramebuffer(e.FRAMEBUFFER,c.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,c.__webglColorRenderbuffer[t]);let n=a.get(i[t]).__webglTexture;r.bindFramebuffer(e.FRAMEBUFFER,c.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,n,0)}r.bindFramebuffer(e.DRAW_FRAMEBUFFER,c.__webglMultisampledFramebuffer)}else if(t.depthBuffer&&!1===t.resolveDepthBuffer&&d){let r=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,[r])}}}function getRenderTargetSamples(e){return Math.min(n.maxSamples,e.samples)}function useMultisampledRTT(e){let r=a.get(e);return e.samples>0&&!0===t.has("WEBGL_multisampled_render_to_texture")&&!1!==r.__useRenderToTexture}function updateVideoTexture(e){let t=s.render.frame;f.get(e)!==t&&(f.set(e,t),e.update())}function verifyColorSpace(e,t){let r=e.colorSpace,a=e.format,n=e.type;return!0===e.isCompressedTexture||!0===e.isVideoTexture||r!==i.Zr2&&""!==r&&("srgb"===i.ppV.getTransfer(r)?(1023!==a||1009!==n)&&(0,i.R8M)("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):(0,i.z3S)("WebGLTextures: Unsupported texture color space:",r)),t}function getDimensions(e){return"u">typeof HTMLImageElement&&e instanceof HTMLImageElement?(u.width=e.naturalWidth||e.width,u.height=e.naturalHeight||e.height):"u">typeof VideoFrame&&e instanceof VideoFrame?(u.width=e.displayWidth,u.height=e.displayHeight):(u.width=e.width,u.height=e.height),u}this.allocateTextureUnit=allocateTextureUnit,this.resetTextureUnits=resetTextureUnits,this.getTextureUnits=getTextureUnits,this.setTextureUnits=setTextureUnits,this.setTexture2D=setTexture2D,this.setTexture2DArray=setTexture2DArray,this.setTexture3D=setTexture3D,this.setTextureCube=setTextureCube,this.rebindTextures=rebindTextures,this.setupRenderTarget=setupRenderTarget,this.updateRenderTargetMipmap=updateRenderTargetMipmap,this.updateMultisampleRenderTarget=updateMultisampleRenderTarget,this.setupDepthRenderbuffer=setupDepthRenderbuffer,this.setupFrameBufferTexture=setupFrameBufferTexture,this.useMultisampledRTT=useMultisampledRTT,this.isReversedDepthBuffer=function(){return r.buffers.depth.getReversed()}}function WebGLUtils(e,t){return{convert:function(r){let a,n=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"",o=i.ppV.getTransfer(n);if(1009===r)return e.UNSIGNED_BYTE;if(1017===r)return e.UNSIGNED_SHORT_4_4_4_4;if(1018===r)return e.UNSIGNED_SHORT_5_5_5_1;if(35902===r)return e.UNSIGNED_INT_5_9_9_9_REV;if(35899===r)return e.UNSIGNED_INT_10F_11F_11F_REV;if(1010===r)return e.BYTE;if(1011===r)return e.SHORT;if(1012===r)return e.UNSIGNED_SHORT;if(1013===r)return e.INT;if(1014===r)return e.UNSIGNED_INT;if(1015===r)return e.FLOAT;if(1016===r)return e.HALF_FLOAT;if(1021===r)return e.ALPHA;if(1022===r)return e.RGB;if(1023===r)return e.RGBA;if(1026===r)return e.DEPTH_COMPONENT;if(1027===r)return e.DEPTH_STENCIL;if(1028===r)return e.RED;if(1029===r)return e.RED_INTEGER;if(1030===r)return e.RG;if(1031===r)return e.RG_INTEGER;if(1033===r)return e.RGBA_INTEGER;if(33776===r||33777===r||33778===r||33779===r)if("srgb"===o){if(null===(a=t.get("WEBGL_compressed_texture_s3tc_srgb")))return null;if(33776===r)return a.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(33777===r)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(33778===r)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(33779===r)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else{if(null===(a=t.get("WEBGL_compressed_texture_s3tc")))return null;if(33776===r)return a.COMPRESSED_RGB_S3TC_DXT1_EXT;if(33777===r)return a.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(33778===r)return a.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(33779===r)return a.COMPRESSED_RGBA_S3TC_DXT5_EXT}if(35840===r||35841===r||35842===r||35843===r){if(null===(a=t.get("WEBGL_compressed_texture_pvrtc")))return null;if(35840===r)return a.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(35841===r)return a.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(35842===r)return a.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(35843===r)return a.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}if(36196===r||37492===r||37496===r||37488===r||37489===r||37490===r||37491===r){if(null===(a=t.get("WEBGL_compressed_texture_etc")))return null;if(36196===r||37492===r)return"srgb"===o?a.COMPRESSED_SRGB8_ETC2:a.COMPRESSED_RGB8_ETC2;if(37496===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:a.COMPRESSED_RGBA8_ETC2_EAC;if(37488===r)return a.COMPRESSED_R11_EAC;if(37489===r)return a.COMPRESSED_SIGNED_R11_EAC;if(37490===r)return a.COMPRESSED_RG11_EAC;if(37491===r)return a.COMPRESSED_SIGNED_RG11_EAC}if(37808===r||37809===r||37810===r||37811===r||37812===r||37813===r||37814===r||37815===r||37816===r||37817===r||37818===r||37819===r||37820===r||37821===r){if(null===(a=t.get("WEBGL_compressed_texture_astc")))return null;if(37808===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:a.COMPRESSED_RGBA_ASTC_4x4_KHR;if(37809===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:a.COMPRESSED_RGBA_ASTC_5x4_KHR;if(37810===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:a.COMPRESSED_RGBA_ASTC_5x5_KHR;if(37811===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:a.COMPRESSED_RGBA_ASTC_6x5_KHR;if(37812===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:a.COMPRESSED_RGBA_ASTC_6x6_KHR;if(37813===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:a.COMPRESSED_RGBA_ASTC_8x5_KHR;if(37814===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:a.COMPRESSED_RGBA_ASTC_8x6_KHR;if(37815===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:a.COMPRESSED_RGBA_ASTC_8x8_KHR;if(37816===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:a.COMPRESSED_RGBA_ASTC_10x5_KHR;if(37817===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:a.COMPRESSED_RGBA_ASTC_10x6_KHR;if(37818===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:a.COMPRESSED_RGBA_ASTC_10x8_KHR;if(37819===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:a.COMPRESSED_RGBA_ASTC_10x10_KHR;if(37820===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:a.COMPRESSED_RGBA_ASTC_12x10_KHR;if(37821===r)return"srgb"===o?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:a.COMPRESSED_RGBA_ASTC_12x12_KHR}if(36492===r||36494===r||36495===r){if(null===(a=t.get("EXT_texture_compression_bptc")))return null;if(36492===r)return"srgb"===o?a.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:a.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(36494===r)return a.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(36495===r)return a.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}if(36283===r||36284===r||36285===r||36286===r){if(null===(a=t.get("EXT_texture_compression_rgtc")))return null;if(36283===r)return a.COMPRESSED_RED_RGTC1_EXT;if(36284===r)return a.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(36285===r)return a.COMPRESSED_RED_GREEN_RGTC2_EXT;if(36286===r)return a.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}return 1020===r?e.UNSIGNED_INT_24_8:void 0!==e[r]?e[r]:null}}}let Z=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Q=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;let WebXRDepthSensing=class WebXRDepthSensing{init(e,t){if(null===this.texture){let r=new i.rjZ(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=r}}getMesh(e){if(null!==this.texture&&null===this.mesh){let t=e.cameras[0].viewport,r=new i.BKk({vertexShader:Z,fragmentShader:Q,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new i.eaF(new i.bdM(20,20),r)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}};let WebXRManager=class WebXRManager extends i.Qev{constructor(e,t){super();const r=this;let a=null,n=1,o=null,s="local-floor",l=1,c=null,d=null,u=null,f=null,p=null,m=null;const h="u">typeof XRWebGLBinding,g=new WebXRDepthSensing,_={},v=t.getContextAttributes();let E=null,S=null;const T=[],M=[],x=new i.I9Y;let R=null;const b=new i.ubm;b.viewport=new i.IUQ;const A=new i.ubm;A.viewport=new i.IUQ;const C=[b,A],P=new i.nZQ;let L=null,U=null;function onSessionEvent(e){let t=M.indexOf(e.inputSource);if(-1===t)return;let r=T[t];void 0!==r&&(r.update(e.inputSource,e.frame,c||o),r.dispatchEvent({type:e.type,data:e.inputSource}))}function onSessionEnd(){a.removeEventListener("select",onSessionEvent),a.removeEventListener("selectstart",onSessionEvent),a.removeEventListener("selectend",onSessionEvent),a.removeEventListener("squeeze",onSessionEvent),a.removeEventListener("squeezestart",onSessionEvent),a.removeEventListener("squeezeend",onSessionEvent),a.removeEventListener("end",onSessionEnd),a.removeEventListener("inputsourceschange",onInputSourcesChange);for(let e=0;e<T.length;e++){let t=M[e];null!==t&&(M[e]=null,T[e].disconnect(t))}for(let e in L=null,U=null,g.reset(),_)delete _[e];e.setRenderTarget(E),p=null,f=null,u=null,a=null,S=null,y.stop(),r.isPresenting=!1,e.setPixelRatio(R),e.setSize(x.width,x.height,!1),r.dispatchEvent({type:"sessionend"})}function onInputSourcesChange(e){for(let t=0;t<e.removed.length;t++){let r=e.removed[t],i=M.indexOf(r);i>=0&&(M[i]=null,T[i].disconnect(r))}for(let t=0;t<e.added.length;t++){let r=e.added[t],i=M.indexOf(r);if(-1===i){for(let e=0;e<T.length;e++)if(e>=M.length){M.push(r),i=e;break}else if(null===M[e]){M[e]=r,i=e;break}if(-1===i)break}let a=T[i];a&&a.connect(r)}}this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(e){let t=T[e];return void 0===t&&(t=new i.R3r,T[e]=t),t.getTargetRaySpace()},this.getControllerGrip=function(e){let t=T[e];return void 0===t&&(t=new i.R3r,T[e]=t),t.getGripSpace()},this.getHand=function(e){let t=T[e];return void 0===t&&(t=new i.R3r,T[e]=t),t.getHandSpace()},this.setFramebufferScaleFactor=function(e){n=e,!0===r.isPresenting&&(0,i.R8M)("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(e){s=e,!0===r.isPresenting&&(0,i.R8M)("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(e){c=e},this.getBaseLayer=function(){return null!==f?f:p},this.getBinding=function(){return null===u&&h&&(u=new XRWebGLBinding(a,t)),u},this.getFrame=function(){return m},this.getSession=function(){return a},this.setSession=async function(d){if(null!==(a=d)){if(E=e.getRenderTarget(),a.addEventListener("select",onSessionEvent),a.addEventListener("selectstart",onSessionEvent),a.addEventListener("selectend",onSessionEvent),a.addEventListener("squeeze",onSessionEvent),a.addEventListener("squeezestart",onSessionEvent),a.addEventListener("squeezeend",onSessionEvent),a.addEventListener("end",onSessionEnd),a.addEventListener("inputsourceschange",onInputSourcesChange),!0!==v.xrCompatible&&await t.makeXRCompatible(),R=e.getPixelRatio(),e.getSize(x),h&&"createProjectionLayer"in XRWebGLBinding.prototype){let r=null,o=null,s=null;v.depth&&(s=v.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,r=v.stencil?1027:1026,o=v.stencil?1020:1014);let l={colorFormat:t.RGBA8,depthFormat:s,scaleFactor:n};f=(u=this.getBinding()).createProjectionLayer(l),a.updateRenderState({layers:[f]}),e.setPixelRatio(1),e.setSize(f.textureWidth,f.textureHeight,!1),S=new i.nWS(f.textureWidth,f.textureHeight,{format:1023,type:1009,depthTexture:new i.VCu(f.textureWidth,f.textureHeight,o,void 0,void 0,void 0,void 0,void 0,void 0,r),stencilBuffer:v.stencil,colorSpace:e.outputColorSpace,samples:4*!!v.antialias,resolveDepthBuffer:!1===f.ignoreDepthValues,resolveStencilBuffer:!1===f.ignoreDepthValues})}else{let r={antialias:v.antialias,alpha:!0,depth:v.depth,stencil:v.stencil,framebufferScaleFactor:n};p=new XRWebGLLayer(a,t,r),a.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),S=new i.nWS(p.framebufferWidth,p.framebufferHeight,{format:1023,type:1009,colorSpace:e.outputColorSpace,stencilBuffer:v.stencil,resolveDepthBuffer:!1===p.ignoreDepthValues,resolveStencilBuffer:!1===p.ignoreDepthValues})}S.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await a.requestReferenceSpace(s),y.setContext(a),y.start(),r.isPresenting=!0,r.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(null!==a)return a.environmentBlendMode},this.getDepthTexture=function(){return g.getDepthTexture()};const D=new i.Pq0,w=new i.Pq0;function setProjectionFromUnion(e,t,r){D.setFromMatrixPosition(t.matrixWorld),w.setFromMatrixPosition(r.matrixWorld);let i=D.distanceTo(w),a=t.projectionMatrix.elements,n=r.projectionMatrix.elements,o=a[14]/(a[10]-1),s=a[14]/(a[10]+1),l=(a[9]+1)/a[5],c=(a[9]-1)/a[5],d=(a[8]-1)/a[0],u=(n[8]+1)/n[0],f=i/(-d+u),p=-(f*d);if(t.matrixWorld.decompose(e.position,e.quaternion,e.scale),e.translateX(p),e.translateZ(f),e.matrixWorld.compose(e.position,e.quaternion,e.scale),e.matrixWorldInverse.copy(e.matrixWorld).invert(),-1===a[10])e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse);else{let t=o+f,r=s+f;e.projectionMatrix.makePerspective(o*d-p,o*u+(i-p),l*s/r*t,c*s/r*t,t,r),e.projectionMatrixInverse.copy(e.projectionMatrix).invert()}}function updateCamera(e,t){null===t?e.matrixWorld.copy(e.matrix):e.matrixWorld.multiplyMatrices(t.matrixWorld,e.matrix),e.matrixWorldInverse.copy(e.matrixWorld).invert()}function updateUserCamera(e,t,r){null===r?e.matrix.copy(t.matrixWorld):(e.matrix.copy(r.matrixWorld),e.matrix.invert(),e.matrix.multiply(t.matrixWorld)),e.matrix.decompose(e.position,e.quaternion,e.scale),e.updateMatrixWorld(!0),e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse),e.isPerspectiveCamera&&(e.fov=2*i.a55*Math.atan(1/e.projectionMatrix.elements[5]),e.zoom=1)}this.updateCamera=function(e){if(null===a)return;let t=e.near,r=e.far;null!==g.texture&&(g.depthNear>0&&(t=g.depthNear),g.depthFar>0&&(r=g.depthFar)),P.near=A.near=b.near=t,P.far=A.far=b.far=r,(L!==P.near||U!==P.far)&&(a.updateRenderState({depthNear:P.near,depthFar:P.far}),L=P.near,U=P.far),P.layers.mask=6|e.layers.mask,b.layers.mask=-5&P.layers.mask,A.layers.mask=-3&P.layers.mask;let i=e.parent,n=P.cameras;updateCamera(P,i);for(let e=0;e<n.length;e++)updateCamera(n[e],i);2===n.length?setProjectionFromUnion(P,b,A):P.projectionMatrix.copy(b.projectionMatrix),updateUserCamera(e,P,i)},this.getCamera=function(){return P},this.getFoveation=function(){if(null!==f||null!==p)return l},this.setFoveation=function(e){l=e,null!==f&&(f.fixedFoveation=e),null!==p&&void 0!==p.fixedFoveation&&(p.fixedFoveation=e)},this.hasDepthSensing=function(){return null!==g.texture},this.getDepthSensingMesh=function(){return g.getMesh(P)},this.getCameraTexture=function(e){return _[e]};let I=null;function onAnimationFrame(t,n){if(d=n.getViewerPose(c||o),m=n,null!==d){let t=d.views;null!==p&&(e.setRenderTargetFramebuffer(S,p.framebuffer),e.setRenderTarget(S));let n=!1;t.length!==P.cameras.length&&(P.cameras.length=0,n=!0);for(let r=0;r<t.length;r++){let a=t[r],o=null;if(null!==p)o=p.getViewport(a);else{let t=u.getViewSubImage(f,a);o=t.viewport,0===r&&(e.setRenderTargetTextures(S,t.colorTexture,t.depthStencilTexture),e.setRenderTarget(S))}let s=C[r];void 0===s&&((s=new i.ubm).layers.enable(r),s.viewport=new i.IUQ,C[r]=s),s.matrix.fromArray(a.transform.matrix),s.matrix.decompose(s.position,s.quaternion,s.scale),s.projectionMatrix.fromArray(a.projectionMatrix),s.projectionMatrixInverse.copy(s.projectionMatrix).invert(),s.viewport.set(o.x,o.y,o.width,o.height),0===r&&(P.matrix.copy(s.matrix),P.matrix.decompose(P.position,P.quaternion,P.scale)),!0===n&&P.cameras.push(s)}let o=a.enabledFeatures;if(o&&o.includes("depth-sensing")&&"gpu-optimized"==a.depthUsage&&h){let e=(u=r.getBinding()).getDepthInformation(t[0]);e&&e.isValid&&e.texture&&g.init(e,a.renderState)}if(o&&o.includes("camera-access")&&h){e.state.unbindTexture(),u=r.getBinding();for(let e=0;e<t.length;e++){let r=t[e].camera;if(r){let e=_[r];e||(e=new i.rjZ,_[r]=e);let t=u.getCameraImage(r);e.sourceTexture=t}}}}for(let e=0;e<T.length;e++){let t=M[e],r=T[e];null!==t&&void 0!==r&&r.update(t,n,c||o)}I&&I(t,n),n.detectedPlanes&&r.dispatchEvent({type:"planesdetected",data:n}),m=null}const y=new WebGLAnimation;y.setAnimationLoop(onAnimationFrame),this.setAnimationLoop=function(e){I=e},this.dispose=function(){}}};let J=new i.kn4,$=new i.dwI;function WebGLMaterials(e,t){function refreshTransformUniform(e,t){!0===e.matrixAutoUpdate&&e.updateMatrix(),t.value.copy(e.matrix)}function refreshUniformsCommon(e,r){e.opacity.value=r.opacity,r.color&&e.diffuse.value.copy(r.color),r.emissive&&e.emissive.value.copy(r.emissive).multiplyScalar(r.emissiveIntensity),r.map&&(e.map.value=r.map,refreshTransformUniform(r.map,e.mapTransform)),r.alphaMap&&(e.alphaMap.value=r.alphaMap,refreshTransformUniform(r.alphaMap,e.alphaMapTransform)),r.bumpMap&&(e.bumpMap.value=r.bumpMap,refreshTransformUniform(r.bumpMap,e.bumpMapTransform),e.bumpScale.value=r.bumpScale,1===r.side&&(e.bumpScale.value*=-1)),r.normalMap&&(e.normalMap.value=r.normalMap,refreshTransformUniform(r.normalMap,e.normalMapTransform),e.normalScale.value.copy(r.normalScale),1===r.side&&e.normalScale.value.negate()),r.displacementMap&&(e.displacementMap.value=r.displacementMap,refreshTransformUniform(r.displacementMap,e.displacementMapTransform),e.displacementScale.value=r.displacementScale,e.displacementBias.value=r.displacementBias),r.emissiveMap&&(e.emissiveMap.value=r.emissiveMap,refreshTransformUniform(r.emissiveMap,e.emissiveMapTransform)),r.specularMap&&(e.specularMap.value=r.specularMap,refreshTransformUniform(r.specularMap,e.specularMapTransform)),r.alphaTest>0&&(e.alphaTest.value=r.alphaTest);let i=t.get(r),a=i.envMap,n=i.envMapRotation;a&&(e.envMap.value=a,e.envMapRotation.value.setFromMatrix4(J.makeRotationFromEuler(n)).transpose(),a.isCubeTexture&&!1===a.isRenderTargetTexture&&e.envMapRotation.value.premultiply($),e.reflectivity.value=r.reflectivity,e.ior.value=r.ior,e.refractionRatio.value=r.refractionRatio),r.lightMap&&(e.lightMap.value=r.lightMap,e.lightMapIntensity.value=r.lightMapIntensity,refreshTransformUniform(r.lightMap,e.lightMapTransform)),r.aoMap&&(e.aoMap.value=r.aoMap,e.aoMapIntensity.value=r.aoMapIntensity,refreshTransformUniform(r.aoMap,e.aoMapTransform))}function refreshUniformsLine(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,t.map&&(e.map.value=t.map,refreshTransformUniform(t.map,e.mapTransform))}function refreshUniformsDash(e,t){e.dashSize.value=t.dashSize,e.totalSize.value=t.dashSize+t.gapSize,e.scale.value=t.scale}function refreshUniformsPoints(e,t,r,i){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.size.value=t.size*r,e.scale.value=.5*i,t.map&&(e.map.value=t.map,refreshTransformUniform(t.map,e.uvTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,refreshTransformUniform(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function refreshUniformsSprites(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.rotation.value=t.rotation,t.map&&(e.map.value=t.map,refreshTransformUniform(t.map,e.mapTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,refreshTransformUniform(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function refreshUniformsPhong(e,t){e.specular.value.copy(t.specular),e.shininess.value=Math.max(t.shininess,1e-4)}function refreshUniformsToon(e,t){t.gradientMap&&(e.gradientMap.value=t.gradientMap)}function refreshUniformsStandard(e,t){e.metalness.value=t.metalness,t.metalnessMap&&(e.metalnessMap.value=t.metalnessMap,refreshTransformUniform(t.metalnessMap,e.metalnessMapTransform)),e.roughness.value=t.roughness,t.roughnessMap&&(e.roughnessMap.value=t.roughnessMap,refreshTransformUniform(t.roughnessMap,e.roughnessMapTransform)),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)}function refreshUniformsPhysical(e,t,r){e.ior.value=t.ior,t.sheen>0&&(e.sheenColor.value.copy(t.sheenColor).multiplyScalar(t.sheen),e.sheenRoughness.value=t.sheenRoughness,t.sheenColorMap&&(e.sheenColorMap.value=t.sheenColorMap,refreshTransformUniform(t.sheenColorMap,e.sheenColorMapTransform)),t.sheenRoughnessMap&&(e.sheenRoughnessMap.value=t.sheenRoughnessMap,refreshTransformUniform(t.sheenRoughnessMap,e.sheenRoughnessMapTransform))),t.clearcoat>0&&(e.clearcoat.value=t.clearcoat,e.clearcoatRoughness.value=t.clearcoatRoughness,t.clearcoatMap&&(e.clearcoatMap.value=t.clearcoatMap,refreshTransformUniform(t.clearcoatMap,e.clearcoatMapTransform)),t.clearcoatRoughnessMap&&(e.clearcoatRoughnessMap.value=t.clearcoatRoughnessMap,refreshTransformUniform(t.clearcoatRoughnessMap,e.clearcoatRoughnessMapTransform)),t.clearcoatNormalMap&&(e.clearcoatNormalMap.value=t.clearcoatNormalMap,refreshTransformUniform(t.clearcoatNormalMap,e.clearcoatNormalMapTransform),e.clearcoatNormalScale.value.copy(t.clearcoatNormalScale),1===t.side&&e.clearcoatNormalScale.value.negate())),t.dispersion>0&&(e.dispersion.value=t.dispersion),t.iridescence>0&&(e.iridescence.value=t.iridescence,e.iridescenceIOR.value=t.iridescenceIOR,e.iridescenceThicknessMinimum.value=t.iridescenceThicknessRange[0],e.iridescenceThicknessMaximum.value=t.iridescenceThicknessRange[1],t.iridescenceMap&&(e.iridescenceMap.value=t.iridescenceMap,refreshTransformUniform(t.iridescenceMap,e.iridescenceMapTransform)),t.iridescenceThicknessMap&&(e.iridescenceThicknessMap.value=t.iridescenceThicknessMap,refreshTransformUniform(t.iridescenceThicknessMap,e.iridescenceThicknessMapTransform))),t.transmission>0&&(e.transmission.value=t.transmission,e.transmissionSamplerMap.value=r.texture,e.transmissionSamplerSize.value.set(r.width,r.height),t.transmissionMap&&(e.transmissionMap.value=t.transmissionMap,refreshTransformUniform(t.transmissionMap,e.transmissionMapTransform)),e.thickness.value=t.thickness,t.thicknessMap&&(e.thicknessMap.value=t.thicknessMap,refreshTransformUniform(t.thicknessMap,e.thicknessMapTransform)),e.attenuationDistance.value=t.attenuationDistance,e.attenuationColor.value.copy(t.attenuationColor)),t.anisotropy>0&&(e.anisotropyVector.value.set(t.anisotropy*Math.cos(t.anisotropyRotation),t.anisotropy*Math.sin(t.anisotropyRotation)),t.anisotropyMap&&(e.anisotropyMap.value=t.anisotropyMap,refreshTransformUniform(t.anisotropyMap,e.anisotropyMapTransform))),e.specularIntensity.value=t.specularIntensity,e.specularColor.value.copy(t.specularColor),t.specularColorMap&&(e.specularColorMap.value=t.specularColorMap,refreshTransformUniform(t.specularColorMap,e.specularColorMapTransform)),t.specularIntensityMap&&(e.specularIntensityMap.value=t.specularIntensityMap,refreshTransformUniform(t.specularIntensityMap,e.specularIntensityMapTransform))}function refreshUniformsMatcap(e,t){t.matcap&&(e.matcap.value=t.matcap)}function refreshUniformsDistance(e,r){let i=t.get(r).light;e.referencePosition.value.setFromMatrixPosition(i.matrixWorld),e.nearDistance.value=i.shadow.camera.near,e.farDistance.value=i.shadow.camera.far}return{refreshFogUniforms:function(t,r){r.color.getRGB(t.fogColor.value,(0,i._Ut)(e)),r.isFog?(t.fogNear.value=r.near,t.fogFar.value=r.far):r.isFogExp2&&(t.fogDensity.value=r.density)},refreshMaterialUniforms:function(e,t,r,i,a){t.isNodeMaterial?t.uniformsNeedUpdate=!1:t.isMeshBasicMaterial?refreshUniformsCommon(e,t):t.isMeshLambertMaterial?(refreshUniformsCommon(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshToonMaterial?(refreshUniformsCommon(e,t),refreshUniformsToon(e,t)):t.isMeshPhongMaterial?(refreshUniformsCommon(e,t),refreshUniformsPhong(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshStandardMaterial?(refreshUniformsCommon(e,t),refreshUniformsStandard(e,t),t.isMeshPhysicalMaterial&&refreshUniformsPhysical(e,t,a)):t.isMeshMatcapMaterial?(refreshUniformsCommon(e,t),refreshUniformsMatcap(e,t)):t.isMeshDepthMaterial?refreshUniformsCommon(e,t):t.isMeshDistanceMaterial?(refreshUniformsCommon(e,t),refreshUniformsDistance(e,t)):t.isMeshNormalMaterial?refreshUniformsCommon(e,t):t.isLineBasicMaterial?(refreshUniformsLine(e,t),t.isLineDashedMaterial&&refreshUniformsDash(e,t)):t.isPointsMaterial?refreshUniformsPoints(e,t,r,i):t.isSpriteMaterial?refreshUniformsSprites(e,t):t.isShadowMaterial?(e.color.value.copy(t.color),e.opacity.value=t.opacity):t.isShaderMaterial&&(t.uniformsNeedUpdate=!1)}}}function WebGLUniformsGroups(e,t,r,a){let n={},o={},s=[],l=e.getParameter(e.MAX_UNIFORM_BUFFER_BINDINGS);function createBuffer(t){let r=allocateBindingPointIndex();t.__bindingPointIndex=r;let i=e.createBuffer(),a=t.__size,n=t.usage;return e.bindBuffer(e.UNIFORM_BUFFER,i),e.bufferData(e.UNIFORM_BUFFER,a,n),e.bindBuffer(e.UNIFORM_BUFFER,null),e.bindBufferBase(e.UNIFORM_BUFFER,r,i),i}function allocateBindingPointIndex(){for(let e=0;e<l;e++)if(-1===s.indexOf(e))return s.push(e),e;return(0,i.z3S)("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function updateBufferData(t){let r=n[t.id],i=t.uniforms,a=t.__cache;e.bindBuffer(e.UNIFORM_BUFFER,r);for(let e=0,t=i.length;e<t;e++){let t=i[e];if(Array.isArray(t))for(let r=0,i=t.length;r<i;r++)updateUniform(t[r],e,r,a);else updateUniform(t,e,0,a)}e.bindBuffer(e.UNIFORM_BUFFER,null)}function updateUniform(t,r,i,a){if(!0===hasUniformChanged(t,r,i,a)){let r=t.__offset,i=t.value;if(Array.isArray(i)){let e=0;for(let r=0;r<i.length;r++){let a=i[r],n=getUniformSize(a);writeUniformValue(a,t.__data,e),"number"==typeof a||"boolean"==typeof a||a.isMatrix3||ArrayBuffer.isView(a)||(e+=n.storage/Float32Array.BYTES_PER_ELEMENT)}}else writeUniformValue(i,t.__data,0);e.bufferSubData(e.UNIFORM_BUFFER,r,t.__data)}}function writeUniformValue(e,t,r){"number"==typeof e||"boolean"==typeof e?t[0]=e:e.isMatrix3?(t[0]=e.elements[0],t[1]=e.elements[1],t[2]=e.elements[2],t[3]=0,t[4]=e.elements[3],t[5]=e.elements[4],t[6]=e.elements[5],t[7]=0,t[8]=e.elements[6],t[9]=e.elements[7],t[10]=e.elements[8],t[11]=0):ArrayBuffer.isView(e)?t.set(new e.constructor(e.buffer,e.byteOffset,t.length)):e.toArray(t,r)}function hasUniformChanged(e,t,r,i){let a=e.value,n=t+"_"+r;if(void 0===i[n])return"number"==typeof a||"boolean"==typeof a?i[n]=a:ArrayBuffer.isView(a)?i[n]=a.slice():i[n]=a.clone(),!0;{let e=i[n];if("number"==typeof a||"boolean"==typeof a){if(e!==a)return i[n]=a,!0}else if(ArrayBuffer.isView(a))return!0;else if(!1===e.equals(a))return e.copy(a),!0}return!1}function prepareUniformsGroup(e){let t=e.uniforms,r=0;for(let e=0,i=t.length;e<i;e++){let i=Array.isArray(t[e])?t[e]:[t[e]];for(let e=0,t=i.length;e<t;e++){let t=i[e],a=Array.isArray(t.value)?t.value:[t.value];for(let e=0,i=a.length;e<i;e++){let i=getUniformSize(a[e]),n=r%16,o=n%i.boundary,s=n+o;r+=o,0!==s&&16-s<i.storage&&(r+=16-s),t.__data=new Float32Array(i.storage/Float32Array.BYTES_PER_ELEMENT),t.__offset=r,r+=i.storage}}}let i=r%16;return i>0&&(r+=16-i),e.__size=r,e.__cache={},this}function getUniformSize(e){let t={boundary:0,storage:0};return"number"==typeof e||"boolean"==typeof e?(t.boundary=4,t.storage=4):e.isVector2?(t.boundary=8,t.storage=8):e.isVector3||e.isColor?(t.boundary=16,t.storage=12):e.isVector4?(t.boundary=16,t.storage=16):e.isMatrix3?(t.boundary=48,t.storage=48):e.isMatrix4?(t.boundary=64,t.storage=64):e.isTexture?(0,i.R8M)("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(e)?(t.boundary=16,t.storage=e.byteLength):(0,i.R8M)("WebGLRenderer: Unsupported uniform value type.",e),t}function onUniformsGroupsDispose(t){let r=t.target;r.removeEventListener("dispose",onUniformsGroupsDispose);let i=s.indexOf(r.__bindingPointIndex);s.splice(i,1),e.deleteBuffer(n[r.id]),delete n[r.id],delete o[r.id]}return{bind:function(e,t){let r=t.program;a.uniformBlockBinding(e,r)},update:function(e,r){let i=n[e.id];void 0===i&&(prepareUniformsGroup(e),i=createBuffer(e),n[e.id]=i,e.addEventListener("dispose",onUniformsGroupsDispose));let s=r.program;a.updateUBOMapping(e,s);let l=t.render.frame;o[e.id]!==l&&(updateBufferData(e),o[e.id]=l)},dispose:function(){for(let t in n)e.deleteBuffer(n[t]);s=[],n={},o={}}}}$.set(-1,0,0,0,1,0,0,0,1);let ee=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),et=null;function getDFGLUT(){return null===et&&((et=new i.GYF(ee,16,16,1030,1016)).name="DFG_LUT",et.minFilter=1006,et.magFilter=1006,et.wrapS=1001,et.wrapT=1001,et.generateMipmaps=!1,et.needsUpdate=!0),et}let WebGLRenderer=class WebGLRenderer{get coordinateSystem(){return 2e3}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=i.ppV._getDrawingBufferColorSpace(e),t.unpackColorSpace=i.ppV._getUnpackColorSpace()}constructor(e={}){let t,r,a,n,o,s,l,c,d,u,f,p,m,h,g,_,v,E,S,T,M,x,R,b;const{canvas:A=(0,i.lPF)(),context:C=null,depth:P=!0,stencil:L=!1,alpha:U=!1,antialias:D=!1,premultipliedAlpha:w=!0,preserveDrawingBuffer:I=!1,powerPreference:y="default",failIfMajorPerformanceCaveat:N=!1,reversedDepthBuffer:F=!1,outputBufferType:O=1009}=e;if(this.isWebGLRenderer=!0,null!==C){if("u">typeof WebGLRenderingContext&&C instanceof WebGLRenderingContext)throw Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");t=C.getContextAttributes().alpha}else t=U;const B=new Set([1033,1031,1029]),G=new Set([1009,1014,1012,1020,1017,1018]),V=new Uint32Array(4),H=new Int32Array(4),W=new i.Pq0;let z=null,k=null;const X=[],q=[];let Y=null;this.domElement=A,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=0,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const j=this;let K=!1,Z=null,Q=null,J=null,$=null;this._outputColorSpace="srgb";let ee=0,et=0,er=null,ei=-1,ea=null;const en=new i.IUQ,eo=new i.IUQ;let es=null;const el=new i.Q1f(0);let ec=0,ed=A.width,eu=A.height,ef=1,ep=null,em=null;const eh=new i.IUQ(0,0,ed,eu),eg=new i.IUQ(0,0,ed,eu);let e_=!1;const ev=new i.PPD;let eE=!1,eS=!1;const eT=new i.kn4,eM=new i.Pq0,ex=new i.IUQ,eR={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let eb=!1;function getTargetPixelRatio(){return null===er?ef:1}let eA=C;function getContext(e,t){return A.getContext(e,t)}try{if("setAttribute"in A&&A.setAttribute("data-engine","three.js r".concat("185")),A.addEventListener("webglcontextlost",onContextLost,!1),A.addEventListener("webglcontextrestored",onContextRestore,!1),A.addEventListener("webglcontextcreationerror",onContextCreationError,!1),null===eA){const e="webgl2";if(eA=getContext(e,{alpha:!0,depth:P,stencil:L,antialias:D,premultipliedAlpha:w,preserveDrawingBuffer:I,powerPreference:y,failIfMajorPerformanceCaveat:N}),null===eA)if(getContext(e))throw Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.");else throw Error("THREE.WebGLRenderer: Error creating WebGL context.")}}catch(e){throw(0,i.z3S)("WebGLRenderer: "+e.message),e}function initGLContext(){(r=new WebGLExtensions(eA)).init(),x=new WebGLUtils(eA,r),a=new WebGLCapabilities(eA,r,e,x),n=new WebGLState(eA,r),a.reversedDepthBuffer&&F&&n.buffers.depth.setReversed(!0),Q=eA.createFramebuffer(),J=eA.createFramebuffer(),$=eA.createFramebuffer(),o=new WebGLInfo(eA),s=new WebGLProperties,l=new WebGLTextures(eA,r,n,s,a,x,o),c=new WebGLEnvironments(j),d=new WebGLAttributes(eA),R=new WebGLBindingStates(eA,d),u=new WebGLGeometries(eA,d,o,R),f=new WebGLObjects(eA,u,d,R,o),S=new WebGLMorphtargets(eA,a,l),_=new WebGLClipping(s),p=new WebGLPrograms(j,c,r,a,R,_),m=new WebGLMaterials(j,s),h=new WebGLRenderLists,g=new WebGLRenderStates(r),E=new WebGLBackground(j,c,n,f,t,w),v=new WebGLShadowMap(j,f,a),b=new WebGLUniformsGroups(eA,o,a,n),T=new WebGLBufferRenderer(eA,r,o),M=new WebGLIndexedBufferRenderer(eA,r,o),o.programs=p.programs,j.capabilities=a,j.extensions=r,j.properties=s,j.renderLists=h,j.shadowMap=v,j.state=n,j.info=o}initGLContext(),1009!==O&&(Y=new WebGLOutput(O,A.width,A.height,D,P,L));const eC=new WebXRManager(j,eA);function onContextLost(e){e.preventDefault(),(0,i.Rm2)("WebGLRenderer: Context Lost."),K=!0}function onContextRestore(){(0,i.Rm2)("WebGLRenderer: Context Restored."),K=!1;let e=o.autoReset,t=v.enabled,r=v.autoUpdate,a=v.needsUpdate,n=v.type;initGLContext(),o.autoReset=e,v.enabled=t,v.autoUpdate=r,v.needsUpdate=a,v.type=n}function onContextCreationError(e){(0,i.z3S)("WebGLRenderer: A WebGL context could not be created. Reason: ",e.statusMessage)}function onMaterialDispose(e){let t=e.target;t.removeEventListener("dispose",onMaterialDispose),deallocateMaterial(t)}function deallocateMaterial(e){releaseMaterialProgramReferences(e),s.remove(e)}function releaseMaterialProgramReferences(e){let t=s.get(e).programs;void 0!==t&&(t.forEach(function(e){p.releaseProgram(e)}),e.isShaderMaterial&&p.releaseShaderCache(e))}function prepareMaterial(e,t,r){!0===e.transparent&&2===e.side&&!1===e.forceSinglePass?(e.side=1,e.needsUpdate=!0,getProgram(e,t,r),e.side=0,e.needsUpdate=!0,getProgram(e,t,r),e.side=2):getProgram(e,t,r)}this.xr=eC,this.getContext=function(){return eA},this.getContextAttributes=function(){return eA.getContextAttributes()},this.forceContextLoss=function(){let e=r.get("WEBGL_lose_context");e&&e.loseContext()},this.forceContextRestore=function(){let e=r.get("WEBGL_lose_context");e&&e.restoreContext()},this.getPixelRatio=function(){return ef},this.setPixelRatio=function(e){void 0!==e&&(ef=e,this.setSize(ed,eu,!1))},this.getSize=function(e){return e.set(ed,eu)},this.setSize=function(e,t){let r=!(arguments.length>2)||void 0===arguments[2]||arguments[2];eC.isPresenting?(0,i.R8M)("WebGLRenderer: Can't change size while VR device is presenting."):(ed=e,eu=t,A.width=Math.floor(e*ef),A.height=Math.floor(t*ef),!0===r&&(A.style.width=e+"px",A.style.height=t+"px"),null!==Y&&Y.setSize(A.width,A.height),this.setViewport(0,0,e,t))},this.getDrawingBufferSize=function(e){return e.set(ed*ef,eu*ef).floor()},this.setDrawingBufferSize=function(e,t,r){ed=e,eu=t,ef=r,A.width=Math.floor(e*r),A.height=Math.floor(t*r),this.setViewport(0,0,e,t)},this.setEffects=function(e){if(1009===O)return void(0,i.z3S)("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");if(e){for(let t=0;t<e.length;t++)if(!0===e[t].isOutputPass){(0,i.R8M)("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}Y.setEffects(e||[])},this.getCurrentViewport=function(e){return e.copy(en)},this.getViewport=function(e){return e.copy(eh)},this.setViewport=function(e,t,r,i){e.isVector4?eh.set(e.x,e.y,e.z,e.w):eh.set(e,t,r,i),n.viewport(en.copy(eh).multiplyScalar(ef).round())},this.getScissor=function(e){return e.copy(eg)},this.setScissor=function(e,t,r,i){e.isVector4?eg.set(e.x,e.y,e.z,e.w):eg.set(e,t,r,i),n.scissor(eo.copy(eg).multiplyScalar(ef).round())},this.getScissorTest=function(){return e_},this.setScissorTest=function(e){n.setScissorTest(e_=e)},this.setOpaqueSort=function(e){ep=e},this.setTransparentSort=function(e){em=e},this.getClearColor=function(e){return e.copy(E.getClearColor())},this.setClearColor=function(){E.setClearColor(...arguments)},this.getClearAlpha=function(){return E.getClearAlpha()},this.setClearAlpha=function(){E.setClearAlpha(...arguments)},this.clear=function(){let e=!(arguments.length>0)||void 0===arguments[0]||arguments[0],t=!(arguments.length>1)||void 0===arguments[1]||arguments[1],r=!(arguments.length>2)||void 0===arguments[2]||arguments[2],i=0;if(e){let e=!1;if(null!==er){let t=er.texture.format;e=B.has(t)}if(e){let e=er.texture.type,t=G.has(e),r=E.getClearColor(),i=E.getClearAlpha(),a=r.r,n=r.g,o=r.b;t?(V[0]=a,V[1]=n,V[2]=o,V[3]=i,eA.clearBufferuiv(eA.COLOR,0,V)):(H[0]=a,H[1]=n,H[2]=o,H[3]=i,eA.clearBufferiv(eA.COLOR,0,H))}else i|=eA.COLOR_BUFFER_BIT}t&&(i|=eA.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),r&&(i|=eA.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(0xffffffff)),0!==i&&eA.clear(i)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(e){e.setRenderer(this),Z=e},this.dispose=function(){A.removeEventListener("webglcontextlost",onContextLost,!1),A.removeEventListener("webglcontextrestored",onContextRestore,!1),A.removeEventListener("webglcontextcreationerror",onContextCreationError,!1),E.dispose(),h.dispose(),g.dispose(),s.dispose(),c.dispose(),f.dispose(),R.dispose(),b.dispose(),p.dispose(),eC.dispose(),eC.removeEventListener("sessionstart",onXRSessionStart),eC.removeEventListener("sessionend",onXRSessionEnd),eL.stop()},this.renderBufferDirect=function(e,t,i,a,o,l){let c;null===t&&(t=eR);let f=o.isMesh&&0>o.matrixWorld.determinantAffine(),p=setProgram(e,t,i,a,o);n.setMaterial(a,f);let m=i.index,h=1;if(!0===a.wireframe){if(void 0===(m=u.getWireframeAttribute(i)))return;h=2}let g=i.drawRange,_=i.attributes.position,v=g.start*h,E=(g.start+g.count)*h;null!==l&&(v=Math.max(v,l.start*h),E=Math.min(E,(l.start+l.count)*h)),null!==m?(v=Math.max(v,0),E=Math.min(E,m.count)):null!=_&&(v=Math.max(v,0),E=Math.min(E,_.count));let S=E-v;if(S<0||1/0===S)return;R.setup(o,a,p,i,m);let x=T;if(null!==m&&(c=d.get(m),(x=M).setIndex(c)),o.isMesh)!0===a.wireframe?(n.setLineWidth(a.wireframeLinewidth*getTargetPixelRatio()),x.setMode(eA.LINES)):x.setMode(eA.TRIANGLES);else if(o.isLine){let e=a.linewidth;void 0===e&&(e=1),n.setLineWidth(e*getTargetPixelRatio()),o.isLineSegments?x.setMode(eA.LINES):o.isLineLoop?x.setMode(eA.LINE_LOOP):x.setMode(eA.LINE_STRIP)}else o.isPoints?x.setMode(eA.POINTS):o.isSprite&&x.setMode(eA.TRIANGLES);if(o.isBatchedMesh)if(r.get("WEBGL_multi_draw"))x.renderMultiDraw(o._multiDrawStarts,o._multiDrawCounts,o._multiDrawCount);else{let e=o._multiDrawStarts,t=o._multiDrawCounts,r=o._multiDrawCount,i=m?d.get(m).bytesPerElement:1,n=s.get(a).currentProgram.getUniforms();for(let a=0;a<r;a++)n.setValue(eA,"_gl_DrawID",a),x.render(e[a]/i,t[a])}else if(o.isInstancedMesh)x.renderInstances(v,S,o.count);else if(i.isInstancedBufferGeometry){let e=void 0!==i._maxInstanceCount?i._maxInstanceCount:1/0,t=Math.min(i.instanceCount,e);x.renderInstances(v,S,t)}else x.render(v,S)},this.compile=function(e,t){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:null;null===r&&(r=e),(k=g.get(r)).init(t),q.push(k),r.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(k.pushLight(e),e.castShadow&&k.pushShadow(e))}),e!==r&&e.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(k.pushLight(e),e.castShadow&&k.pushShadow(e))}),k.setupLights();let i=new Set;return e.traverse(function(e){if(!(e.isMesh||e.isPoints||e.isLine||e.isSprite))return;let t=e.material;if(t)if(Array.isArray(t))for(let a=0;a<t.length;a++){let n=t[a];prepareMaterial(n,r,e),i.add(n)}else prepareMaterial(t,r,e),i.add(t)}),k=q.pop(),i},this.compileAsync=function(e,t){let i=arguments.length>2&&void 0!==arguments[2]?arguments[2]:null,a=this.compile(e,t,i);return new Promise(t=>{function checkMaterialsReady(){(a.forEach(function(e){s.get(e).currentProgram.isReady()&&a.delete(e)}),0===a.size)?t(e):setTimeout(checkMaterialsReady,10)}null!==r.get("KHR_parallel_shader_compile")?checkMaterialsReady():setTimeout(checkMaterialsReady,10)})};let eP=null;function onAnimationFrame(e){eP&&eP(e)}function onXRSessionStart(){eL.stop()}function onXRSessionEnd(){eL.start()}const eL=new WebGLAnimation;function projectObject(e,t,r,i){if(!1===e.visible)return;if(e.layers.test(t.layers)){if(e.isGroup)r=e.renderOrder;else if(e.isLOD)!0===e.autoUpdate&&e.update(t);else if(e.isLightProbeGrid)k.pushLightProbeGrid(e);else if(e.isLight)k.pushLight(e),e.castShadow&&k.pushShadow(e);else if(e.isSprite){if(!e.frustumCulled||ev.intersectsSprite(e)){i&&ex.setFromMatrixPosition(e.matrixWorld).applyMatrix4(eT);let t=f.update(e),a=e.material;a.visible&&z.push(e,t,a,r,ex.z,null)}}else if((e.isMesh||e.isLine||e.isPoints)&&(!e.frustumCulled||ev.intersectsObject(e))){let t=f.update(e),a=e.material;if(i&&(void 0!==e.boundingSphere?(null===e.boundingSphere&&e.computeBoundingSphere(),ex.copy(e.boundingSphere.center)):(null===t.boundingSphere&&t.computeBoundingSphere(),ex.copy(t.boundingSphere.center)),ex.applyMatrix4(e.matrixWorld).applyMatrix4(eT)),Array.isArray(a)){let i=t.groups;for(let n=0,o=i.length;n<o;n++){let o=i[n],s=a[o.materialIndex];s&&s.visible&&z.push(e,t,s,r,ex.z,o)}}else a.visible&&z.push(e,t,a,r,ex.z,null)}}let a=e.children;for(let e=0,n=a.length;e<n;e++)projectObject(a[e],t,r,i)}function renderScene(e,t,r,i){let{opaque:a,transmissive:o,transparent:s}=e;k.setupLightsView(r),!0===eE&&_.setGlobalState(j.clippingPlanes,r),i&&n.viewport(en.copy(i)),a.length>0&&renderObjects(a,t,r),o.length>0&&renderObjects(o,t,r),s.length>0&&renderObjects(s,t,r),n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),n.setPolygonOffset(!1)}function renderTransmissionPass(e,t,n,o){if(null!==(!0===n.isScene?n.overrideMaterial:null))return;if(void 0===k.state.transmissionRenderTarget[o.id]){let e=r.has("EXT_color_buffer_half_float")||r.has("EXT_color_buffer_float");k.state.transmissionRenderTarget[o.id]=new i.nWS(1,1,{generateMipmaps:!0,type:e?1016:1009,minFilter:1008,samples:Math.max(4,a.samples),stencilBuffer:L,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:i.ppV.workingColorSpace})}let s=k.state.transmissionRenderTarget[o.id],c=o.viewport||en;s.setSize(c.z*j.transmissionResolutionScale,c.w*j.transmissionResolutionScale);let d=j.getRenderTarget(),u=j.getActiveCubeFace(),f=j.getActiveMipmapLevel();j.setRenderTarget(s),j.getClearColor(el),(ec=j.getClearAlpha())<1&&j.setClearColor(0xffffff,.5),j.clear(),eb&&E.render(n);let p=j.toneMapping;j.toneMapping=0;let m=o.viewport;if(void 0!==o.viewport&&(o.viewport=void 0),k.setupLightsView(o),!0===eE&&_.setGlobalState(j.clippingPlanes,o),renderObjects(e,n,o),l.updateMultisampleRenderTarget(s),l.updateRenderTargetMipmap(s),!1===r.has("WEBGL_multisampled_render_to_texture")){let e=!1;for(let r=0,i=t.length;r<i;r++){let{object:i,geometry:a,material:s,group:l}=t[r];if(2===s.side&&i.layers.test(o.layers)){let t=s.side;s.side=1,s.needsUpdate=!0,renderObject(i,n,o,a,s,l),s.side=t,s.needsUpdate=!0,e=!0}}!0===e&&(l.updateMultisampleRenderTarget(s),l.updateRenderTargetMipmap(s))}j.setRenderTarget(d,u,f),j.setClearColor(el,ec),void 0!==m&&(o.viewport=m),j.toneMapping=p}function renderObjects(e,t,r){let i=!0===t.isScene?t.overrideMaterial:null;for(let a=0,n=e.length;a<n;a++){let n=e[a],{object:o,geometry:s,group:l}=n,c=n.material;!0===c.allowOverride&&null!==i&&(c=i),o.layers.test(r.layers)&&renderObject(o,t,r,s,c,l)}}function renderObject(e,t,r,i,a,n){e.onBeforeRender(j,t,r,i,a,n),e.modelViewMatrix.multiplyMatrices(r.matrixWorldInverse,e.matrixWorld),e.normalMatrix.getNormalMatrix(e.modelViewMatrix),a.onBeforeRender(j,t,r,i,e,n),!0===a.transparent&&2===a.side&&!1===a.forceSinglePass?(a.side=1,a.needsUpdate=!0,j.renderBufferDirect(r,t,i,a,e,n),a.side=0,a.needsUpdate=!0,j.renderBufferDirect(r,t,i,a,e,n),a.side=2):j.renderBufferDirect(r,t,i,a,e,n),e.onAfterRender(j,t,r,i,a,n)}function getProgram(e,t,r){!0!==t.isScene&&(t=eR);let i=s.get(e),a=k.state.lights,n=k.state.shadowsArray,o=a.state.version,l=p.getParameters(e,a.state,n,t,r,k.state.lightProbeGridArray),d=p.getProgramCacheKey(l),u=i.programs;i.environment=e.isMeshStandardMaterial||e.isMeshLambertMaterial||e.isMeshPhongMaterial?t.environment:null,i.fog=t.fog;let f=e.isMeshStandardMaterial||e.isMeshLambertMaterial&&!e.envMap||e.isMeshPhongMaterial&&!e.envMap;i.envMap=c.get(e.envMap||i.environment,f),i.envMapRotation=null!==i.environment&&null===e.envMap?t.environmentRotation:e.envMapRotation,void 0===u&&(e.addEventListener("dispose",onMaterialDispose),i.programs=u=new Map);let m=u.get(d);if(void 0!==m){if(i.currentProgram===m&&i.lightsStateVersion===o)return updateCommonMaterialProperties(e,l),m}else l.uniforms=p.getUniforms(e),null!==Z&&e.isNodeMaterial&&Z.build(e,r,l),e.onBeforeCompile(l,j),m=p.acquireProgram(l,d),u.set(d,m),i.uniforms=l.uniforms;let h=i.uniforms;return(e.isShaderMaterial||e.isRawShaderMaterial)&&!0!==e.clipping||(h.clippingPlanes=_.uniform),updateCommonMaterialProperties(e,l),i.needsLights=materialNeedsLights(e),i.lightsStateVersion=o,i.needsLights&&(h.ambientLightColor.value=a.state.ambient,h.lightProbe.value=a.state.probe,h.directionalLights.value=a.state.directional,h.directionalLightShadows.value=a.state.directionalShadow,h.spotLights.value=a.state.spot,h.spotLightShadows.value=a.state.spotShadow,h.rectAreaLights.value=a.state.rectArea,h.ltc_1.value=a.state.rectAreaLTC1,h.ltc_2.value=a.state.rectAreaLTC2,h.pointLights.value=a.state.point,h.pointLightShadows.value=a.state.pointShadow,h.hemisphereLights.value=a.state.hemi,h.directionalShadowMatrix.value=a.state.directionalShadowMatrix,h.spotLightMatrix.value=a.state.spotLightMatrix,h.spotLightMap.value=a.state.spotLightMap,h.pointShadowMatrix.value=a.state.pointShadowMatrix),i.lightProbeGrid=k.state.lightProbeGridArray.length>0,i.currentProgram=m,i.uniformsList=null,m}function getUniformList(e){if(null===e.uniformsList){let t=e.currentProgram.getUniforms();e.uniformsList=WebGLUniforms.seqWithValue(t.seq,e.uniforms)}return e.uniformsList}function updateCommonMaterialProperties(e,t){let r=s.get(e);r.outputColorSpace=t.outputColorSpace,r.batching=t.batching,r.batchingColor=t.batchingColor,r.instancing=t.instancing,r.instancingColor=t.instancingColor,r.instancingMorph=t.instancingMorph,r.skinning=t.skinning,r.morphTargets=t.morphTargets,r.morphNormals=t.morphNormals,r.morphColors=t.morphColors,r.morphTargetsCount=t.morphTargetsCount,r.numClippingPlanes=t.numClippingPlanes,r.numIntersection=t.numClipIntersection,r.vertexAlphas=t.vertexAlphas,r.vertexTangents=t.vertexTangents,r.toneMapping=t.toneMapping}function findLightProbeGrid(e,t){if(0===e.length)return null;if(1===e.length)return null!==e[0].texture?e[0]:null;W.setFromMatrixPosition(t.matrixWorld);for(let t=0,r=e.length;t<r;t++){let r=e[t];if(null!==r.texture&&r.boundingBox.containsPoint(W))return r}return null}function setProgram(e,t,r,o,d){!0!==t.isScene&&(t=eR),l.resetTextureUnits();let u=t.fog,f=o.isMeshStandardMaterial||o.isMeshLambertMaterial||o.isMeshPhongMaterial?t.environment:null,p=null===er?j.outputColorSpace:!0===er.isXRRenderTarget?er.texture.colorSpace:i.ppV.workingColorSpace,h=o.isMeshStandardMaterial||o.isMeshLambertMaterial&&!o.envMap||o.isMeshPhongMaterial&&!o.envMap,g=c.get(o.envMap||f,h),v=!0===o.vertexColors&&!!r.attributes.color&&4===r.attributes.color.itemSize,E=!!r.attributes.tangent&&(!!o.normalMap||o.anisotropy>0),T=!!r.morphAttributes.position,M=!!r.morphAttributes.normal,x=!!r.morphAttributes.color,R=0;o.toneMapped&&(null===er||!0===er.isXRRenderTarget)&&(R=j.toneMapping);let A=r.morphAttributes.position||r.morphAttributes.normal||r.morphAttributes.color,C=void 0!==A?A.length:0,P=s.get(o),L=k.state.lights;if(!0===eE&&(!0===eS||e!==ea)){let t=e===ea&&o.id===ei;_.setState(o,e,t)}let U=!1;o.version===P.__version?P.needsLights&&P.lightsStateVersion!==L.state.version||P.outputColorSpace!==p||d.isBatchedMesh&&!1===P.batching?U=!0:d.isBatchedMesh||!0!==P.batching?d.isBatchedMesh&&!0===P.batchingColor&&null===d.colorTexture||d.isBatchedMesh&&!1===P.batchingColor&&null!==d.colorTexture||d.isInstancedMesh&&!1===P.instancing?U=!0:d.isInstancedMesh||!0!==P.instancing?d.isSkinnedMesh&&!1===P.skinning?U=!0:d.isSkinnedMesh||!0!==P.skinning?d.isInstancedMesh&&!0===P.instancingColor&&null===d.instanceColor||d.isInstancedMesh&&!1===P.instancingColor&&null!==d.instanceColor||d.isInstancedMesh&&!0===P.instancingMorph&&null===d.morphTexture||d.isInstancedMesh&&!1===P.instancingMorph&&null!==d.morphTexture||P.envMap!==g||!0===o.fog&&P.fog!==u||void 0!==P.numClippingPlanes&&(P.numClippingPlanes!==_.numPlanes||P.numIntersection!==_.numIntersection)||P.vertexAlphas!==v||P.vertexTangents!==E||P.morphTargets!==T||P.morphNormals!==M||P.morphColors!==x||P.toneMapping!==R||P.morphTargetsCount!==C?U=!0:!!P.lightProbeGrid!=k.state.lightProbeGridArray.length>0&&(U=!0):U=!0:U=!0:U=!0:(U=!0,P.__version=o.version);let D=P.currentProgram;!0===U&&(D=getProgram(o,t,d),Z&&o.isNodeMaterial&&Z.onUpdateProgram(o,D,P));let w=!1,I=!1,y=!1,N=D.getUniforms(),F=P.uniforms;if(n.useProgram(D.program)&&(w=!0,I=!0,y=!0),o.id!==ei&&(ei=o.id,I=!0),P.needsLights){let e=findLightProbeGrid(k.state.lightProbeGridArray,d);P.lightProbeGrid!==e&&(P.lightProbeGrid=e,I=!0)}if(w||ea!==e){n.buffers.depth.getReversed()&&!0!==e.reversedDepth&&(e._reversedDepth=!0,e.updateProjectionMatrix()),N.setValue(eA,"projectionMatrix",e.projectionMatrix),N.setValue(eA,"viewMatrix",e.matrixWorldInverse);let t=N.map.cameraPosition;void 0!==t&&t.setValue(eA,eM.setFromMatrixPosition(e.matrixWorld)),a.logarithmicDepthBuffer&&N.setValue(eA,"logDepthBufFC",2/(Math.log(e.far+1)/Math.LN2)),(o.isMeshPhongMaterial||o.isMeshToonMaterial||o.isMeshLambertMaterial||o.isMeshBasicMaterial||o.isMeshStandardMaterial||o.isShaderMaterial)&&N.setValue(eA,"isOrthographic",!0===e.isOrthographicCamera),ea!==e&&(ea=e,I=!0,y=!0)}if(P.needsLights&&(L.state.directionalShadowMap.length>0&&N.setValue(eA,"directionalShadowMap",L.state.directionalShadowMap,l),L.state.spotShadowMap.length>0&&N.setValue(eA,"spotShadowMap",L.state.spotShadowMap,l),L.state.pointShadowMap.length>0&&N.setValue(eA,"pointShadowMap",L.state.pointShadowMap,l)),d.isSkinnedMesh){N.setOptional(eA,d,"bindMatrix"),N.setOptional(eA,d,"bindMatrixInverse");let e=d.skeleton;e&&(null===e.boneTexture&&e.computeBoneTexture(),N.setValue(eA,"boneTexture",e.boneTexture,l))}d.isBatchedMesh&&(N.setOptional(eA,d,"batchingTexture"),N.setValue(eA,"batchingTexture",d._matricesTexture,l),N.setOptional(eA,d,"batchingIdTexture"),N.setValue(eA,"batchingIdTexture",d._indirectTexture,l),N.setOptional(eA,d,"batchingColorTexture"),null!==d._colorsTexture&&N.setValue(eA,"batchingColorTexture",d._colorsTexture,l));let O=r.morphAttributes;if((void 0!==O.position||void 0!==O.normal||void 0!==O.color)&&S.update(d,r,D),(I||P.receiveShadow!==d.receiveShadow)&&(P.receiveShadow=d.receiveShadow,N.setValue(eA,"receiveShadow",d.receiveShadow)),(o.isMeshStandardMaterial||o.isMeshLambertMaterial||o.isMeshPhongMaterial)&&null===o.envMap&&null!==t.environment&&(F.envMapIntensity.value=t.environmentIntensity),void 0!==F.dfgLUT&&(F.dfgLUT.value=getDFGLUT()),I){if(N.setValue(eA,"toneMappingExposure",j.toneMappingExposure),P.needsLights&&markUniformsLightsNeedsUpdate(F,y),u&&!0===o.fog&&m.refreshFogUniforms(F,u),m.refreshMaterialUniforms(F,o,ef,eu,k.state.transmissionRenderTarget[e.id]),P.needsLights&&P.lightProbeGrid){let e=P.lightProbeGrid;F.probesSH.value=e.texture,F.probesMin.value.copy(e.boundingBox.min),F.probesMax.value.copy(e.boundingBox.max),F.probesResolution.value.copy(e.resolution)}WebGLUniforms.upload(eA,getUniformList(P),F,l)}if(o.isShaderMaterial&&!0===o.uniformsNeedUpdate&&(WebGLUniforms.upload(eA,getUniformList(P),F,l),o.uniformsNeedUpdate=!1),o.isSpriteMaterial&&N.setValue(eA,"center",d.center),N.setValue(eA,"modelViewMatrix",d.modelViewMatrix),N.setValue(eA,"normalMatrix",d.normalMatrix),N.setValue(eA,"modelMatrix",d.matrixWorld),void 0!==o.uniformsGroups){let e=o.uniformsGroups;for(let t=0,r=e.length;t<r;t++){let r=e[t];b.update(r,D),b.bind(r,D)}}return D}function markUniformsLightsNeedsUpdate(e,t){e.ambientLightColor.needsUpdate=t,e.lightProbe.needsUpdate=t,e.directionalLights.needsUpdate=t,e.directionalLightShadows.needsUpdate=t,e.pointLights.needsUpdate=t,e.pointLightShadows.needsUpdate=t,e.spotLights.needsUpdate=t,e.spotLightShadows.needsUpdate=t,e.rectAreaLights.needsUpdate=t,e.hemisphereLights.needsUpdate=t}function materialNeedsLights(e){return e.isMeshLambertMaterial||e.isMeshToonMaterial||e.isMeshPhongMaterial||e.isMeshStandardMaterial||e.isShadowMaterial||e.isShaderMaterial&&!0===e.lights}eL.setAnimationLoop(onAnimationFrame),"u">typeof self&&eL.setContext(self),this.setAnimationLoop=function(e){eP=e,eC.setAnimationLoop(e),null===e?eL.stop():eL.start()},eC.addEventListener("sessionstart",onXRSessionStart),eC.addEventListener("sessionend",onXRSessionEnd),this.render=function(e,t){if(void 0!==t&&!0!==t.isCamera)return void(0,i.z3S)("WebGLRenderer.render: camera is not an instance of THREE.Camera.");if(!0===K)return;null!==Z&&Z.renderStart(e,t);let r=!0===eC.enabled&&!0===eC.isPresenting,a=null!==Y&&(null===er||r)&&Y.begin(j,er);if(!0===e.matrixWorldAutoUpdate&&e.updateMatrixWorld(),null===t.parent&&!0===t.matrixWorldAutoUpdate&&t.updateMatrixWorld(),!0===eC.enabled&&!0===eC.isPresenting&&(null===Y||!1===Y.isCompositing())&&(!0===eC.cameraAutoUpdate&&eC.updateCamera(t),t=eC.getCamera()),!0===e.isScene&&e.onBeforeRender(j,e,t,er),(k=g.get(e,q.length)).init(t),k.state.textureUnits=l.getTextureUnits(),q.push(k),eT.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),ev.setFromProjectionMatrix(eT,2e3,t.reversedDepth),eS=this.localClippingEnabled,eE=_.init(this.clippingPlanes,eS),(z=h.get(e,X.length)).init(),X.push(z),!0===eC.enabled&&!0===eC.isPresenting){let e=j.xr.getDepthSensingMesh();null!==e&&projectObject(e,t,-1/0,j.sortObjects)}projectObject(e,t,0,j.sortObjects),z.finish(),!0===j.sortObjects&&z.sort(ep,em,t.reversedDepth),(eb=!1===eC.enabled||!1===eC.isPresenting||!1===eC.hasDepthSensing())&&E.addToRenderList(z,e),this.info.render.frame++,!0===this.info.autoReset&&this.info.reset(),!0===eE&&_.beginShadows();let n=k.state.shadowsArray;if(v.render(n,e,t),!0===eE&&_.endShadows(),!1===(a&&Y.hasRenderPass())){let r=z.opaque,i=z.transmissive;if(k.setupLights(),t.isArrayCamera){let a=t.cameras;if(i.length>0)for(let t=0,n=a.length;t<n;t++)renderTransmissionPass(r,i,e,a[t]);eb&&E.render(e);for(let t=0,r=a.length;t<r;t++){let r=a[t];renderScene(z,e,r,r.viewport)}}else i.length>0&&renderTransmissionPass(r,i,e,t),eb&&E.render(e),renderScene(z,e,t)}null!==er&&0===et&&(l.updateMultisampleRenderTarget(er),l.updateRenderTargetMipmap(er)),a&&Y.end(j),!0===e.isScene&&e.onAfterRender(j,e,t),R.resetDefaultState(),ei=-1,ea=null,q.pop(),q.length>0?(k=q[q.length-1],l.setTextureUnits(k.state.textureUnits),!0===eE&&_.setGlobalState(j.clippingPlanes,k.state.camera)):k=null,X.pop(),z=X.length>0?X[X.length-1]:null,null!==Z&&Z.renderEnd()},this.getActiveCubeFace=function(){return ee},this.getActiveMipmapLevel=function(){return et},this.getRenderTarget=function(){return er},this.setRenderTargetTextures=function(e,t,r){let i=s.get(e);i.__autoAllocateDepthBuffer=!1===e.resolveDepthBuffer,!1===i.__autoAllocateDepthBuffer&&(i.__useRenderToTexture=!1),s.get(e.texture).__webglTexture=t,s.get(e.depthTexture).__webglTexture=i.__autoAllocateDepthBuffer?void 0:r,i.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(e,t){let r=s.get(e);r.__webglFramebuffer=t,r.__useDefaultFramebuffer=void 0===t},this.setRenderTarget=function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0,r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:0;er=e,ee=t,et=r;let i=null,a=!1,o=!1;if(e){let c=s.get(e);if(void 0!==c.__useDefaultFramebuffer){n.bindFramebuffer(eA.FRAMEBUFFER,c.__webglFramebuffer),en.copy(e.viewport),eo.copy(e.scissor),es=e.scissorTest,n.viewport(en),n.scissor(eo),n.setScissorTest(es),ei=-1;return}if(void 0===c.__webglFramebuffer)l.setupRenderTarget(e);else if(c.__hasExternalTextures)l.rebindTextures(e,s.get(e.texture).__webglTexture,s.get(e.depthTexture).__webglTexture);else if(e.depthBuffer){let t=e.depthTexture;if(c.__boundDepthTexture!==t){if(null!==t&&s.has(t)&&(e.width!==t.image.width||e.height!==t.image.height))throw Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");l.setupDepthRenderbuffer(e)}}let d=e.texture;(d.isData3DTexture||d.isDataArrayTexture||d.isCompressedArrayTexture)&&(o=!0);let u=s.get(e).__webglFramebuffer;e.isWebGLCubeRenderTarget?(i=Array.isArray(u[t])?u[t][r]:u[t],a=!0):i=e.samples>0&&!1===l.useMultisampledRTT(e)?s.get(e).__webglMultisampledFramebuffer:Array.isArray(u)?u[r]:u,en.copy(e.viewport),eo.copy(e.scissor),es=e.scissorTest}else en.copy(eh).multiplyScalar(ef).floor(),eo.copy(eg).multiplyScalar(ef).floor(),es=e_;if(0!==r&&(i=Q),n.bindFramebuffer(eA.FRAMEBUFFER,i)&&n.drawBuffers(e,i),n.viewport(en),n.scissor(eo),n.setScissorTest(es),a){let i=s.get(e.texture);eA.framebufferTexture2D(eA.FRAMEBUFFER,eA.COLOR_ATTACHMENT0,eA.TEXTURE_CUBE_MAP_POSITIVE_X+t,i.__webglTexture,r)}else if(o)for(let i=0;i<e.textures.length;i++){let a=s.get(e.textures[i]);eA.framebufferTextureLayer(eA.FRAMEBUFFER,eA.COLOR_ATTACHMENT0+i,a.__webglTexture,r,t)}else if(null!==e&&0!==r){let t=s.get(e.texture);eA.framebufferTexture2D(eA.FRAMEBUFFER,eA.COLOR_ATTACHMENT0,eA.TEXTURE_2D,t.__webglTexture,r)}ei=-1},this.readRenderTargetPixels=function(e,t,r,o,l,c,d){let u=arguments.length>7&&void 0!==arguments[7]?arguments[7]:0;if(!(e&&e.isWebGLRenderTarget))return void(0,i.z3S)("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let f=s.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&void 0!==d&&(f=f[d]),f){n.bindFramebuffer(eA.FRAMEBUFFER,f);try{let n=e.textures[u],s=n.format,d=n.type;if(e.textures.length>1&&eA.readBuffer(eA.COLOR_ATTACHMENT0+u),!a.textureFormatReadable(s))return void(0,i.z3S)("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");if(!a.textureTypeReadable(d))return void(0,i.z3S)("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");t>=0&&t<=e.width-o&&r>=0&&r<=e.height-l&&eA.readPixels(t,r,o,l,x.convert(s),x.convert(d),c)}finally{let e=null!==er?s.get(er).__webglFramebuffer:null;n.bindFramebuffer(eA.FRAMEBUFFER,e)}}},this.readRenderTargetPixelsAsync=async function(e,t,r,o,l,c,d){let u=arguments.length>7&&void 0!==arguments[7]?arguments[7]:0;if(!(e&&e.isWebGLRenderTarget))throw Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let f=s.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&void 0!==d&&(f=f[d]),f)if(t>=0&&t<=e.width-o&&r>=0&&r<=e.height-l){n.bindFramebuffer(eA.FRAMEBUFFER,f);let d=e.textures[u],p=d.format,m=d.type;if(e.textures.length>1&&eA.readBuffer(eA.COLOR_ATTACHMENT0+u),!a.textureFormatReadable(p))throw Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!a.textureTypeReadable(m))throw Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let h=eA.createBuffer();eA.bindBuffer(eA.PIXEL_PACK_BUFFER,h),eA.bufferData(eA.PIXEL_PACK_BUFFER,c.byteLength,eA.STREAM_READ),eA.readPixels(t,r,o,l,x.convert(p),x.convert(m),0);let g=null!==er?s.get(er).__webglFramebuffer:null;n.bindFramebuffer(eA.FRAMEBUFFER,g);let _=eA.fenceSync(eA.SYNC_GPU_COMMANDS_COMPLETE,0);return eA.flush(),await (0,i.jej)(eA,_,4),eA.bindBuffer(eA.PIXEL_PACK_BUFFER,h),eA.getBufferSubData(eA.PIXEL_PACK_BUFFER,0,c),eA.deleteBuffer(h),eA.deleteSync(_),c}else throw Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:null,r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:0,i=Math.pow(2,-r),a=Math.floor(e.image.width*i),o=Math.floor(e.image.height*i),s=null!==t?t.x:0,c=null!==t?t.y:0;l.setTexture2D(e,0),eA.copyTexSubImage2D(eA.TEXTURE_2D,r,0,0,s,c,a,o),n.unbindTexture()},this.copyTextureToTexture=function(e,t){let r,i,a,o,c,d,u,f,p,m,h=arguments.length>2&&void 0!==arguments[2]?arguments[2]:null,g=arguments.length>3&&void 0!==arguments[3]?arguments[3]:null,_=arguments.length>4&&void 0!==arguments[4]?arguments[4]:0,v=arguments.length>5&&void 0!==arguments[5]?arguments[5]:0,E=e.isCompressedTexture?e.mipmaps[v]:e.image;if(null!==h)r=h.max.x-h.min.x,i=h.max.y-h.min.y,a=h.isBox3?h.max.z-h.min.z:1,o=h.min.x,c=h.min.y,d=h.isBox3?h.min.z:0;else{let t=Math.pow(2,-_);r=Math.floor(E.width*t),i=Math.floor(E.height*t),a=e.isDataArrayTexture?E.depth:e.isData3DTexture?Math.floor(E.depth*t):1,o=0,c=0,d=0}null!==g?(u=g.x,f=g.y,p=g.z):(u=0,f=0,p=0);let S=x.convert(t.format),T=x.convert(t.type);t.isData3DTexture?(l.setTexture3D(t,0),m=eA.TEXTURE_3D):t.isDataArrayTexture||t.isCompressedArrayTexture?(l.setTexture2DArray(t,0),m=eA.TEXTURE_2D_ARRAY):(l.setTexture2D(t,0),m=eA.TEXTURE_2D),n.activeTexture(eA.TEXTURE0),n.pixelStorei(eA.UNPACK_FLIP_Y_WEBGL,t.flipY),n.pixelStorei(eA.UNPACK_PREMULTIPLY_ALPHA_WEBGL,t.premultiplyAlpha),n.pixelStorei(eA.UNPACK_ALIGNMENT,t.unpackAlignment);let M=n.getParameter(eA.UNPACK_ROW_LENGTH),R=n.getParameter(eA.UNPACK_IMAGE_HEIGHT),b=n.getParameter(eA.UNPACK_SKIP_PIXELS),A=n.getParameter(eA.UNPACK_SKIP_ROWS),C=n.getParameter(eA.UNPACK_SKIP_IMAGES);n.pixelStorei(eA.UNPACK_ROW_LENGTH,E.width),n.pixelStorei(eA.UNPACK_IMAGE_HEIGHT,E.height),n.pixelStorei(eA.UNPACK_SKIP_PIXELS,o),n.pixelStorei(eA.UNPACK_SKIP_ROWS,c),n.pixelStorei(eA.UNPACK_SKIP_IMAGES,d);let P=e.isDataArrayTexture||e.isData3DTexture,L=t.isDataArrayTexture||t.isData3DTexture;if(e.isDepthTexture){let l=s.get(e),m=s.get(t),h=s.get(l.__renderTarget),g=s.get(m.__renderTarget);n.bindFramebuffer(eA.READ_FRAMEBUFFER,h.__webglFramebuffer),n.bindFramebuffer(eA.DRAW_FRAMEBUFFER,g.__webglFramebuffer);for(let n=0;n<a;n++)P&&(eA.framebufferTextureLayer(eA.READ_FRAMEBUFFER,eA.COLOR_ATTACHMENT0,s.get(e).__webglTexture,_,d+n),eA.framebufferTextureLayer(eA.DRAW_FRAMEBUFFER,eA.COLOR_ATTACHMENT0,s.get(t).__webglTexture,v,p+n)),eA.blitFramebuffer(o,c,r,i,u,f,r,i,eA.DEPTH_BUFFER_BIT,eA.NEAREST);n.bindFramebuffer(eA.READ_FRAMEBUFFER,null),n.bindFramebuffer(eA.DRAW_FRAMEBUFFER,null)}else if(0!==_||e.isRenderTargetTexture||s.has(e)){let l=s.get(e),h=s.get(t);n.bindFramebuffer(eA.READ_FRAMEBUFFER,J),n.bindFramebuffer(eA.DRAW_FRAMEBUFFER,$);for(let e=0;e<a;e++)P?eA.framebufferTextureLayer(eA.READ_FRAMEBUFFER,eA.COLOR_ATTACHMENT0,l.__webglTexture,_,d+e):eA.framebufferTexture2D(eA.READ_FRAMEBUFFER,eA.COLOR_ATTACHMENT0,eA.TEXTURE_2D,l.__webglTexture,_),L?eA.framebufferTextureLayer(eA.DRAW_FRAMEBUFFER,eA.COLOR_ATTACHMENT0,h.__webglTexture,v,p+e):eA.framebufferTexture2D(eA.DRAW_FRAMEBUFFER,eA.COLOR_ATTACHMENT0,eA.TEXTURE_2D,h.__webglTexture,v),0!==_?eA.blitFramebuffer(o,c,r,i,u,f,r,i,eA.COLOR_BUFFER_BIT,eA.NEAREST):L?eA.copyTexSubImage3D(m,v,u,f,p+e,o,c,r,i):eA.copyTexSubImage2D(m,v,u,f,o,c,r,i);n.bindFramebuffer(eA.READ_FRAMEBUFFER,null),n.bindFramebuffer(eA.DRAW_FRAMEBUFFER,null)}else L?e.isDataTexture||e.isData3DTexture?eA.texSubImage3D(m,v,u,f,p,r,i,a,S,T,E.data):t.isCompressedArrayTexture?eA.compressedTexSubImage3D(m,v,u,f,p,r,i,a,S,E.data):eA.texSubImage3D(m,v,u,f,p,r,i,a,S,T,E):e.isDataTexture?eA.texSubImage2D(eA.TEXTURE_2D,v,u,f,r,i,S,T,E.data):e.isCompressedTexture?eA.compressedTexSubImage2D(eA.TEXTURE_2D,v,u,f,E.width,E.height,S,E.data):eA.texSubImage2D(eA.TEXTURE_2D,v,u,f,r,i,S,T,E);n.pixelStorei(eA.UNPACK_ROW_LENGTH,M),n.pixelStorei(eA.UNPACK_IMAGE_HEIGHT,R),n.pixelStorei(eA.UNPACK_SKIP_PIXELS,b),n.pixelStorei(eA.UNPACK_SKIP_ROWS,A),n.pixelStorei(eA.UNPACK_SKIP_IMAGES,C),0===v&&t.generateMipmaps&&eA.generateMipmap(m),n.unbindTexture()},this.initRenderTarget=function(e){void 0===s.get(e).__webglFramebuffer&&l.setupRenderTarget(e)},this.initTexture=function(e){e.isCubeTexture?l.setTextureCube(e,0):e.isData3DTexture?l.setTexture3D(e,0):e.isDataArrayTexture||e.isCompressedArrayTexture?l.setTexture2DArray(e,0):l.setTexture2D(e,0),n.unbindTexture()},this.resetState=function(){ee=0,et=0,er=null,n.reset(),R.reset()},"u">typeof __THREE_DEVTOOLS__&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}}}}]);