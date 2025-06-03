'use strict';

let gl;                         // The webgl context.
let surface;                    // A surface model
let shProgram;                  // A shader program
let shProgramWebCam;            // A shader program for webcam
let spaceball;                  // A SimpleRotator object that lets the user rotate the view by mouse.
let stereoCam;                  // Object holding stereo camera and its parameters

let iTextureWebCam = -1;

let video;

let websocket;
let magnetometerData = { x: 0, y: 0, z: 0 };
let lastMagnetometerData = { x: 0, y: 0, z: 0 };
let usePhoneSensor = false;
let lastMagnetometerMatrix = m4.identity();

// New variables for improved motion smoothing
let lastUpdateTime = 0;
let updateInterval = 50; // milliseconds between updates (20 updates per second)
let rotationMatrixHistory = [];
let maxHistoryLength = 5; // Number of matrices to keep for averaging
let customSmoothingFactor = 0.3; // Default value, will be configurable

function connectToSensorServer() {
    const serverUrl = document.getElementById('serverUrl').value;
    
    if (!serverUrl) {
        alert('Please enter the Sensor Server WebSocket URL');
        return;
    }
    
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close();
    }
    
    websocket = new WebSocket(serverUrl);
    
    websocket.onopen = function() {
        console.log('Connected to Sensor Server');
        usePhoneSensor = true;
        document.getElementById('connectionStatus').textContent = 'Connected';
        document.getElementById('connectionStatus').style.color = 'green';
        document.getElementById('sensorStatus').textContent = 'Enabled';
        document.getElementById('sensorStatus').style.color = 'green';
    };
    
    websocket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            
            const currentTime = Date.now();
            if (currentTime - lastUpdateTime < updateInterval) {
                return;
            }
            lastUpdateTime = currentTime;
            
            if (data.values && data.values.length >= 3) {
                const mag = data.values;
                
                magnetometerData = {
                    x: lastMagnetometerData.x * (1 - customSmoothingFactor) + parseFloat(mag[0]) * customSmoothingFactor,
                    y: lastMagnetometerData.y * (1 - customSmoothingFactor) + parseFloat(mag[1]) * customSmoothingFactor,
                    z: lastMagnetometerData.z * (1 - customSmoothingFactor) + parseFloat(mag[2]) * customSmoothingFactor
                };
                lastMagnetometerData = { ...magnetometerData };
    
                document.getElementById('magX').textContent = magnetometerData.x.toFixed(2);
                document.getElementById('magY').textContent = magnetometerData.y.toFixed(2);
                document.getElementById('magZ').textContent = magnetometerData.z.toFixed(2);
    
                const newMatrix = calculateMagnetometerMatrix(magnetometerData);
                
                rotationMatrixHistory.push(newMatrix);
                
                if (rotationMatrixHistory.length > maxHistoryLength) {
                    rotationMatrixHistory.shift();
                }
                
                lastMagnetometerMatrix = averageRotationMatrices(rotationMatrixHistory);
            }
        } catch (error) {
            console.error('Error parsing sensor data:', error);
        }
    };
    
    websocket.onclose = function() {
        console.log('Disconnected from Sensor Server');
        usePhoneSensor = false;
        document.getElementById('connectionStatus').textContent = 'Disconnected';
        document.getElementById('connectionStatus').style.color = 'red';
        document.getElementById('sensorStatus').textContent = 'Disabled';
        document.getElementById('sensorStatus').style.color = 'red';
    };
    
    websocket.onerror = function(error) {
        console.error('WebSocket error:', error);
        usePhoneSensor = false;
        document.getElementById('connectionStatus').textContent = 'Error';
        document.getElementById('connectionStatus').style.color = 'red';
        document.getElementById('sensorStatus').textContent = 'Disabled';
        document.getElementById('sensorStatus').style.color = 'red';
    };
}

function disconnectFromSensorServer() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close();
    }
    usePhoneSensor = false;
    document.getElementById('connectionStatus').textContent = 'Disconnected';
    document.getElementById('connectionStatus').style.color = 'red';
    document.getElementById('sensorStatus').textContent = 'Disabled';
    document.getElementById('sensorStatus').style.color = 'red';
}

function calculateMagnetometerMatrix(mag) {
    const magnitude = Math.sqrt(mag.x * mag.x + mag.y * mag.y + mag.z * mag.z);
    if (magnitude === 0) return m4.identity();
    
    const nx = mag.x / magnitude;
    const ny = mag.y / magnitude;
    const nz = mag.z / magnitude;
    
    // For compass-like behavior, we need to:
    // 1. Calculate heading (yaw) - rotation around vertical axis
    // 2. Calculate pitch - tilt towards ground/sky
    
    // Calculate heading angle (rotation around vertical axis)
    // This gives us the compass direction
    const heading = Math.atan2(ny, nx);
    
    // Calculate pitch (tilt up/down)
    const horizontalMagnitude = Math.sqrt(nx * nx + ny * ny);
    const pitch = Math.atan2(-nz, horizontalMagnitude);
    
    // Create rotation matrices
    const rotZ = m4.zRotation(heading);
    const rotX = m4.xRotation(pitch);
    
    // Combine rotations
    return m4.multiply(rotZ, rotX);
}

function averageRotationMatrices(matrices) {
    if (matrices.length === 0) return m4.identity();
    if (matrices.length === 1) return matrices[0];
    
    let result = m4.identity();
    
    for (let i = 0; i < 16; i++) {
        let sum = 0;
        
        for (let m = 0; m < matrices.length; m++) {
            sum += matrices[m][i];
        }
        
        result[i] = sum / matrices.length;
    }
    
    return result;
}

function updateSmoothingSettings() {
    customSmoothingFactor = parseFloat(document.getElementById('smoothingFactor').value);
    updateInterval = parseInt(document.getElementById('updateInterval').value);
    maxHistoryLength = parseInt(document.getElementById('historyLength').value);
    
    document.getElementById('smoothingFactorValue').textContent = customSmoothingFactor.toFixed(1);
    document.getElementById('updateIntervalValue').textContent = updateInterval;
    document.getElementById('historyLengthValue').textContent = maxHistoryLength;
    
    rotationMatrixHistory = [];
    
    console.log(`Smoothing settings updated: factor=${customSmoothingFactor}, interval=${updateInterval}ms, history=${maxHistoryLength}`);
}

// Constructor
function ShaderProgram(name, program) {
    this.name = name;
    this.prog = program;

    // Location of the attribute variable in the shader program.
    this.iAttribVertex = -1;
    this.iAttribTexCoord = -1;
    // Location of the uniform specifying a color for the primitive.
    this.iColor = -1;
    // Location of the uniform matrix representing the combined transformation.
    this.iModelViewMatrix = -1;
    this.iProjectionMatrix = -1;
    this.iSampler = -1;

    this.Use = function() {
        gl.useProgram(this.prog);
    }
}

/* Draws a colored cube, along with a set of coordinate axes.
 * (Note that the use of the above drawPrimitive function is not an efficient
 * way to draw with WebGL.  Here, the geometry is so simple that it doesn't matter.)
 */
function draw() { 
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // PATH ZERO: DRAW ZERO PARALLAX WEBCAM
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);

    shProgramWebCam.Use();
    gl.uniform1i(shProgramWebCam.iSampler, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    
    // Switch to main shader for 3D model
    shProgram.Use();
    
    /* Get the view matrix from the SimpleRotator object.*/
    let modelView;
    if (usePhoneSensor && lastMagnetometerMatrix) {
        modelView = lastMagnetometerMatrix;
    } else {
        modelView = spaceball.getViewMatrix();
    }

    let rotateToPointZero = m4.axisRotation([0.707, 0.707, 0], 0.7);
    let translateToPointZero = m4.translation(0, 0, -11);

    const colorPolygon = new Float32Array([0.5, 0.5, 0.5, 1]);
    const colorEdge    = new Float32Array([1, 1, 1, 1]);

    // The FIRST PASS (for the left eye)
    let matrLeftFrustum = stereoCam.calcLeftFrustum();
    gl.uniformMatrix4fv(shProgram.iProjectionMatrix, false, matrLeftFrustum);

    let translateLeftEye = m4.translation(stereoCam.eyeSeparation/2, 0, 0);

    let matAccum0 = m4.multiply(rotateToPointZero, modelView);
    let matAccum1 = m4.multiply(translateLeftEye, matAccum0);
    let matAccum2 = m4.multiply(translateToPointZero, matAccum1);
        
    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, matAccum2);

    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 0);
    
    gl.colorMask(true, false, false, true);
    gl.uniform4fv(shProgram.iColor, colorPolygon);
    surface.Draw();
    gl.uniform4fv(shProgram.iColor, colorEdge);
    surface.Draw();

    // The SECOND PASS (for the right eye)
    gl.clear(gl.DEPTH_BUFFER_BIT);

    let matrRightFrustum = stereoCam.calcRightFrustum();
    gl.uniformMatrix4fv(shProgram.iProjectionMatrix, false, matrRightFrustum);

    let translateRightEye = m4.translation(-stereoCam.eyeSeparation/2, 0, 0);

    matAccum0 = m4.multiply(rotateToPointZero, modelView);
    matAccum1 = m4.multiply(translateRightEye, matAccum0);
    matAccum2 = m4.multiply(translateToPointZero, matAccum1);

    gl.uniformMatrix4fv(shProgram.iModelViewMatrix, false, matAccum2);

    gl.colorMask(false, true, true, true);
    gl.uniform4fv(shProgram.iColor, colorPolygon);
    surface.Draw();
    gl.uniform4fv(shProgram.iColor, colorEdge);
    surface.Draw();

    // RESET specific params to their default state
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
}

/* Initialize the WebGL context. Called from init() */
function initGL() {
    // Create main shader program
    let prog = createProgram(gl, vertexShaderSource, fragmentShaderSource);
    shProgram = new ShaderProgram('Basic', prog);
    shProgram.Use();

    shProgram.iAttribVertex = gl.getAttribLocation(prog, "vertex");
    shProgram.iModelViewMatrix = gl.getUniformLocation(prog, "ModelViewMatrix");
    shProgram.iProjectionMatrix = gl.getUniformLocation(prog, "ProjectionMatrix");
    shProgram.iColor = gl.getUniformLocation(prog, "color");

    // Create webcam shader program
    let progWebCam = createProgram(gl, vertexShaderWebCamSource, fragmentShaderWebCamSource);
    shProgramWebCam = new ShaderProgram('WebCam', progWebCam);
    shProgramWebCam.Use();

    shProgramWebCam.iSampler = gl.getUniformLocation(progWebCam, "video");

    surface = new Model('Surface');
    surface.CreateSurfaceData();
    
    // Initialize stereo camera
    stereoCam = new StereoCamera(
        0.7,     // eyeSeparation (decimeters)
        14.0,    // convergence (decimeters)
        1.3,     // aspectRatio of canvas
        0.4,     // FOV (radians)
        8.0,     // nearClippingDistance (decimeters)
        20.0     // farClippingDistance (decimeters)
    );

    gl.enable(gl.DEPTH_TEST);
}

/* Creates a program for use in the WebGL context gl, and returns the
 * identifier for that program.  If an error occurs while compiling or
 * linking the program, an exception of type Error is thrown.  The error
 * string contains the compilation or linking error.  If no error occurs,
 * the program identifier is the return value of the function.
 * The second and third parameters are strings that contain the
 * source code for the vertex shader and for the fragment shader.
 */
function createProgram(gl, vShader, fShader) {
    let vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vShader);
    gl.compileShader(vsh);
    if (!gl.getShaderParameter(vsh, gl.COMPILE_STATUS)) {
        throw new Error("Error in vertex shader:  " + gl.getShaderInfoLog(vsh));
    }
    let fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fShader);
    gl.compileShader(fsh);
    if (!gl.getShaderParameter(fsh, gl.COMPILE_STATUS)) {
        throw new Error("Error in fragment shader:  " + gl.getShaderInfoLog(fsh));
    }
    let prog = gl.createProgram();
    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error("Link error in program:  " + gl.getProgramInfoLog(prog));
    }
    return prog;
}

function updateParameters() {
    const eyeSep = parseFloat(document.getElementById('eyeSeparation').value);
    const fov = parseFloat(document.getElementById('fov').value);
    const near = parseFloat(document.getElementById('nearClipping').value);
    const conv = parseFloat(document.getElementById('convergence').value);
    
    stereoCam.eyeSeparation = eyeSep;
    stereoCam.FOV = fov;
    stereoCam.nearClippingDistance = near;
    stereoCam.convergence = conv;
    
    draw();
}

/**
 * initialization function that will be called when the page has loaded
 */
function init() {
    let canvas;
    try {
        canvas = document.getElementById("webglcanvas");
        gl = canvas.getContext("webgl2");
        if (!gl) {
            throw "Browser does not support WebGL";
        }
    }
    catch (e) {
        document.getElementById("canvas-holder").innerHTML =
            "<p>Sorry, could not get a WebGL graphics context.</p>";
        return;
    }
    //try {
        initGL();  // initialize the WebGL graphics context
    // }
    // catch (e) {
    //     console.error("Error initializing WebGL: " + e);
    //     document.getElementById("canvas-holder").innerHTML =
    //         "<p>Sorry, could not initialize the WebGL graphics context: " + e + "</p>";
    //     return;
    // }

    video = document.createElement('video');
    video.autoplay = true;

    // Connect to video stream
    let constraints = {video: true};
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
        video.srcObject = stream;

        let track = stream.getVideoTracks()[0];
        let settings = track.getSettings();

        iTextureWebCam = CreateWebCamTexture(settings.width, settings.height);

        video.play();
    })
    .catch(function(err) {
        console.log(err.name + ": " + err.message);
    });

    // Set up the rendering loop
    setInterval(draw, 1/20 * 1000);

    spaceball = new TrackballRotator(canvas, draw, 0);

    document.getElementById('connectButton').addEventListener('click', connectToSensorServer);
    document.getElementById('toggleSensorButton').addEventListener('click', function() {
        if (usePhoneSensor) {
            disconnectFromSensorServer();
        } else {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                usePhoneSensor = true;
                document.getElementById('sensorStatus').textContent = 'Enabled';
                document.getElementById('sensorStatus').style.color = 'green';
            } else {
                connectToSensorServer();
            }
        }
    });
    
    document.getElementById('smoothingFactor').addEventListener('input', function() {
        document.getElementById('smoothingFactorValue').textContent = this.value;
    });
    document.getElementById('updateInterval').addEventListener('input', function() {
        document.getElementById('updateIntervalValue').textContent = this.value;
    });
    document.getElementById('historyLength').addEventListener('input', function() {
        document.getElementById('historyLengthValue').textContent = this.value;
    });

    // Initial draw
    draw();
}