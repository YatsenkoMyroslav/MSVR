function clamp(v, min, max) {
    return Math.max(min, Math.min(v, max));
}

function generateNeoviusSurface(uSteps, vSteps, uRange, vRange) {
    const vertices = [];
    const indices = [];

    const [uMin, uMax] = uRange;
    const [vMin, vMax] = vRange;

    const du = (uMax - uMin) / uSteps;
    const dv = (vMax - vMin) / vSteps;

    function generator(swizzle) {
        firstIndex = vertices.length / 3;
        for (let i = 0; i <= uSteps; i++) {
            const u = uMin + i * du;
            for (let j = 0; j <= vSteps; j++) {
                const v = vMin + j * dv;
     
                const x = u;
                const y = v;
                const cosU = Math.cos(u);
                const cosV = Math.cos(v);
                const z = Math.acos(clamp(-3 * ((cosU + cosV) / (3 + 4 * cosU * cosV)), -1.0, 1.0));

                vertices.push(...swizzle(x, y, z));
                vertices.push(...swizzle(x, y, -z));
            }
        }

        for (let i = 0; i <= uSteps; i++) {
            for (let j = 0; j <= vSteps; j++) {
                const currentIndex = 2 * (i * (vSteps + 1) + j) + firstIndex;
                const prevUIndex = 2 * ((i - 1) * (vSteps + 1) + j) + firstIndex;
                const prevVIndex = 2 * (i * (vSteps + 1) + (j - 1)) + firstIndex;

                if(i > 0) {
                    indices.push(currentIndex, prevUIndex);
                    indices.push(currentIndex + 1, prevUIndex + 1)
                }

                if(j > 0) {
                    indices.push(currentIndex, prevVIndex);
                    indices.push(currentIndex + 1, prevVIndex + 1);
                }
            }
        }
    }

    generator((x, y, z) => { return [x, y, z]});
    generator((x, y, z) => { return [x, z, y]});
    generator((x, y, z) => { return [z, x, y]});
    return { vertices, indices };
}


function Model() {
    this.iVertexBuffer = gl.createBuffer();
    this.iIndexBuffer = gl.createBuffer();
    this.count = 0;

    this.BufferData = function(vertices, indices) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        this.count = indices.length;
    };

    this.Draw = function() {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribVertex);

        gl.drawElements(gl.LINES, this.count, gl.UNSIGNED_SHORT, 0);
    }

    this.CreateSurfaceData = function() {
        function get(name) {
            return document.getElementById(name).value;
        }

        const uSteps = parseInt(get('USteps'));
        const vSteps = parseInt(get('VSteps'));
        const uRange = [parseFloat(get('UMin')), parseFloat(get('UMax'))]; 
        const vRange = [parseFloat(get('VMin')), parseFloat(get('VMax'))]; 
  
        const { vertices, indices } = generateNeoviusSurface(uSteps, vSteps, uRange, vRange);
        this.BufferData(vertices, indices);
    }
}
