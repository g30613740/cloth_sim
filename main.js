// ============================================================
// 1. Инициализация WebGPU
// ============================================================
async function initWebGPU() {
	// проверка наличия объекта navigator.gpu
	if (!navigator.gpu) {
		alert('Browser does not support WebGPU');
		return;
	}

	// получаем адаптер (физ. устройство GPU)
	// navigator.gpu.requestAdapter занимает время, поэтому он возвращает Promise
	// без await мы бы получили не сам адаптер, а Promise
	const adapter = await navigator.gpu.requestAdapter()
	if (!adapter) {
		alert('could not get an adapter GPU');
		return;
	}

	// получаем устройство (логич интерфейс для работы с GPU)
	const device = await adapter.requestDevice();

	// получаем canvas и создаём контекст webgpu
	const canvas = document.getElementById('canvas')
	const context = canvas.getContext('webgpu')

	// выбираем предпочтит для данного браузера формат пикс
	const format = navigator.gpu.getPreferredCanvasFormat();

	// настройка контекста
	context.configure({
		device: device,
		format: format,
		alphaMode: 'opaque', // непрозрачный фон
	})

	console.log('WebGPU is ready to work');
	console.log('Adapter:', adapter);
	console.log('Device:', device);
	console.log('Format of canvas:', format);

	// возвращаем объекты для дальнейшего использования
	return { device, context, format, canvas };
}

// запуск инициализации
const gpu = await initWebGPU();
if (!gpu) {
	// останавливаемся, если что-то не так
	throw new Error('GPU initialization does not work');
}

const { device, context, format } = gpu;

// ============================================================
// 2. Генерация данных ткани (сетка NxN)
// ============================================================
function buildCloth(N, size) {
    // N - количество сегментов по горизонтали и вертикали
    // size - физический размер квадрата (например, 2.0)
    const vertices = []; // плоский список координат: [x0, y0, z0, x1, y1, z1, x2, y2, z2, ...]
    const indices = [];  // рёбра – пары индексов
	const edgeData = []; // для симуляции: { i, j, restLength }

    const step = size / N;
    const half = size / 2;

    // 1) Вершины: (N+1) x (N+1)
    for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
            const x = -half + i * step;
            const y = -half + j * step;
            vertices.push(x, y, 0.0);
        }
    }

    // Функция для получения индекса вершины по (i, j)
    const idx = (i, j) => j * (N + 1) + i;

	// Функция для добавления ребра с вычислением длины между вершинами a и b
    function addEdge(a, b) {
        const ax = vertices[a * 3];
        const ay = vertices[a * 3 + 1];
        const az = vertices[a * 3 + 2];
        const bx = vertices[b * 3];
        const by = vertices[b * 3 + 1];
        const bz = vertices[b * 3 + 2];
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        indices.push(a, b);
        edgeData.push({ i: a, j: b, restLength: len });
    }

    // Горизонтальные рёбра
    for (let j = 0; j <= N; j++) {
        for (let i = 0; i < N; i++) {
            addEdge(idx(i, j), idx(i+1, j));
        }
    }
    // Вертикальные рёбра
    for (let j = 0; j < N; j++) {
        for (let i = 0; i <= N; i++) {
            addEdge(idx(i, j), idx(i, j+1));
        }
    }

    // диагональные – для жёсткости

    const vertexArray = new Float32Array(vertices);
    const indexArray = new Uint32Array(indices);

    // Преобразуем edgeData в плоский массив: [i, j, restLength] подряд
    const edgeArray = new Float32Array(edgeData.length * 3);
    for (let k = 0; k < edgeData.length; k++) {
        edgeArray[k * 3]     = edgeData[k].i;
        edgeArray[k * 3 + 1] = edgeData[k].j;
        edgeArray[k * 3 + 2] = edgeData[k].restLength;
    }

    return {
        vertices: vertexArray,
        indices: indexArray,
        edges: edgeArray,          // плоский массив для GPU
        numVertices: (N + 1) * (N + 1),
        numEdges: edgeData.length,
        // дополнительные параметры
        N,
        size,
        // закреплённые вершины (углы)
        cornerIndices: [
            idx(0, 0),     // левый нижний
            idx(N, 0),     // правый нижний
            idx(0, N),     // левый верхний
            idx(N, N)      // правый верхний
        ],
        centerIndex: idx(Math.floor(N/2), Math.floor(N/2))
    };
}

// Параметры ткани
const N = 20;          // количество сегментов (20x20 = 400 квадратов)
const size = 2.0;      // размер квадрата в глобальных координатах
const cloth = buildCloth(N, size);

console.log(`Вершин: ${cloth.numVertices}, Рёбер: ${cloth.numEdges}`);

// ============================================================
// 3. Буферы для рендеринга (вершины и индексы)
// ============================================================

// Вершинный буфер
const vertexBuffer = device.createBuffer({
    size: cloth.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});
// 0 - смещение в байтах, cloth.vertices – это Float32Array (для вершин) или Uint32Array (для индексов)
device.queue.writeBuffer(vertexBuffer, 0, cloth.vertices);

// Индексный буфер (рёбра)
const indexBuffer = device.createBuffer({
    size: cloth.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(indexBuffer, 0, cloth.indices);

// ============================================================
// 4. Буферы для симуляции (предыдущие позиции, рёбра, uniform)
// ============================================================

// 4.1. Буфер предыдущих позиций (инициализируем текущими позициями)
const prevPosBuffer = device.createBuffer({
    size: cloth.vertices.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});
device.queue.writeBuffer(prevPosBuffer, 0, cloth.vertices);

// 4.2. Буфер рёбер (плоский массив: i, j, restLength)
const edgeBuffer = device.createBuffer({
    size: cloth.edges.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});
device.queue.writeBuffer(edgeBuffer, 0, cloth.edges);

// 4.3. Uniform-буфер (параметры симуляции)
// Структура в WGSL: 
// struct Uniforms {
//     dt: f32,
//     gravity: f32,
//     time: f32,
//     numIterations: u32,
//     enableGravity: u32,
//     corner0: u32, corner1: u32, corner2: u32, corner3: u32,
//     center: u32,
//     amplitude: f32,
//     frequency: f32,
// };
// Выравнивание: каждое поле должно быть выровнено по 4 байтам.
// Для простоты использую массив из 16 float (64 байта).
const uniformData = new Float32Array([
    0.016,   // dt (шаг по времени)
    9.8,     // gravity
    0.0,     // time (будет обновляться в цикле)
    5.0,     // numIterations (как float, но будем использовать как u32 в шейдере)
    1.0,     // enableGravity (1 - включена, 0 - выключена)
    cloth.cornerIndices[0],
    cloth.cornerIndices[1],
    cloth.cornerIndices[2],
    cloth.cornerIndices[3],
    cloth.centerIndex,
    0.3,     // amplitude (амплитуда колебаний)
    2.0,     // frequency (частота)
    // остальные пока зарезервируем
]);

const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
});
device.queue.writeBuffer(uniformBuffer, 0, uniformData);

// ============================================================
// 5. Шейдеры
// ============================================================
const vertexShaderCode = `
@vertex
fn vs_main(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
    return vec4<f32>(pos, 1.0);
}
`;

const fragmentShaderCode = `
@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return vec4<f32>(0.8, 0.8, 0.8, 1.0); // Светло-серые линии
}
`;

// ============================================================
// 6. Пайплайн рендеринга (теперь line-list)
// ============================================================
const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module: device.createShaderModule({ code: vertexShaderCode }),
        entryPoint: 'vs_main',
        buffers: [
            {
                arrayStride: 3 * 4, // 3 float по 4 байта
                attributes: [
                    {
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x3',
                    },
                ],
            },
        ],
    },
    fragment: {
        module: device.createShaderModule({ code: fragmentShaderCode }),
        entryPoint: 'fs_main',
        targets: [{ format }],
    },
    primitive: {
        topology: 'line-list', // Рисуем линии (каждые 2 индекса – отрезок)
    },
});


// ============================================================
// 7. Цикл анимации (пока только рендеринг)
// ============================================================
function frame() {
    // Здесь позже будет обновление uniform-буфера (time) и вызов compute-проходов
    // Пока просто рисую статичную сетку.

    const encoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: textureView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
            },
        ],
    });

    renderPass.setPipeline(pipeline);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.setIndexBuffer(indexBuffer, 'uint32');
    renderPass.drawIndexed(cloth.indices.length);

    renderPass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(frame);
}

frame();