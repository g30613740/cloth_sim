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

// Отладка: для доступа к cloth из консоли
window.cloth = cloth;

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
    0.001,                    // 0. dt (шаг по времени)
    9.8,                      // 1. gravity
    0.0,                      // 2. time (будет обновляться в  frame())
    0.0,                      // 3. enableGravity (1 - вкл, 0 - выкл)
    cloth.cornerIndices[0],   // 4
    cloth.cornerIndices[1],   // 5
    cloth.cornerIndices[2],   // 6
    cloth.cornerIndices[3],   // 7
    cloth.centerIndex,        // 8
    1.0,                      // 9. amplitude
    2.0,                      // 10. frequency
    2.0,                      // 11. numIterations (количество итераций PBD)
    canvas.width,             // canvasWidth
    canvas.height             // canvasHeight
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
struct Uniforms {
    dt: f32,
    gravity: f32,
    time: f32,
    enableGravity: f32,
    corner0: u32,
    corner1: u32,
    corner2: u32,
    corner3: u32,
    center: u32,
    amplitude: f32,
    frequency: f32,
    numIterations: f32,
    canvasWidth: f32,
    canvasHeight: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {

    // Изометрический поворот вокруг X
    let angle = 0.5;
    let cosA = cos(angle);
    let sinA = sin(angle);
    var p = vec3<f32>(pos.x, pos.y * cosA - pos.z * sinA, pos.y * sinA + pos.z * cosA);
    
    // Масштаб, чтобы ткань занимала примерно 80% высоты экрана
    let desiredHeight = 0.8;
    let clothHalfHeight = 1.0 * cosA; // половина высоты ткани после поворота (max |y|)
    let scale = desiredHeight / clothHalfHeight;
    
    // Корректировка по X с учётом aspect ratio
    let aspect = uniforms.canvasWidth / uniforms.canvasHeight;
    var xNDC = p.x * scale / aspect;
    var yNDC = p.y * scale;
    
    // Опускаем камеру немного вниз, чтобы видеть верхнюю часть ткани
    // (опционально, зависит от желаемого ракурса)
    // yNDC -= 0.1;
    
    return vec4<f32>(xNDC, yNDC, 0.0, 1.0);
}
`;

const fragmentShaderCode = `
@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return vec4<f32>(0.8, 0.8, 0.8, 1.0); // Светло-серые линии
}
`;

// ============================================================
// 6. Пайплайн рендеринга
// ============================================================
const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module: device.createShaderModule({ code: vertexShaderCode }),
        entryPoint: 'vs_main',
        buffers: [
            {
                // шаг для перехода к следующей вершине
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
// COMPUTE-ШЕЙДЕР 1: Verlet-интеграция (обновление позиций)
// ============================================================

const integrateShaderCode = `
// Объявляем буфер вершин как массив трёхмерных векторов.
// Доступ: чтение и запись (read_write).
@group(0) @binding(0) var<storage, read_write> vertices: array<f32>;

// Буфер предыдущих позиций: чтение/запись
@group(0) @binding(1) var<storage, read_write> prevPositions: array<f32>;

// Uniform-буфер с параметрами (одинак для всех потоков)
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

// Буфер для ограничения нерастяжимости
// @group(0) @binding(3) var<storage, read> edges: array<f32>;

struct Uniforms {
    dt: f32,             // шаг по времени
    gravity: f32,
    time: f32,
    enableGravity: f32,  // флаг: вкл/выкл гравитация
    corner0: u32,
    corner1: u32,
    corner2: u32,
    corner3: u32,
    center: u32,
    amplitude: f32,
    frequency: f32,
    numIterations: f32,
    canvasWidth: f32,
    canvasHeight: f32,
};

// === Verlet-интеграция
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {

    let i = id.x;                                   // индекс вершины из первой компоненты id
    
    // Проверка по количеству float'ов: каждая вершина занимает 3 числа
    if (i * 3u + 2u >= arrayLength(&vertices)) { return; }

    let idx3 = i * 3u;

    // Чтение текущей позиции
    var pos = vec3<f32>(
        vertices[idx3],
        vertices[idx3 + 1u],
        vertices[idx3 + 2u]
    );

    // === 1. Углы закреплены: пропускаем интеграцию (оставляем их на месте) ===
    let isCorner = (i == uniforms.corner0 || i == uniforms.corner1 ||
                    i == uniforms.corner2 || i == uniforms.corner3);
    if (isCorner) { return; }

    // === 2. Центральная вершина обраб отдельно, движ по закону синуса ===
    if (i == uniforms.center) {
        // Начальная позиция центра (хранится в prevPositions, т.к. мы её никогда не обновляем)
        let basePos = vec3<f32>(
            prevPositions[idx3],
            prevPositions[idx3 + 1u],
            prevPositions[idx3 + 2u]
        );

        // Вычисляем смещение по Y по синусу
        let offsetY = uniforms.amplitude * sin(uniforms.time * uniforms.frequency);
        let newCenterPos = vec3<f32>(basePos.x, basePos.y + offsetY, basePos.z);

        // Записываем новую позицию центра
        vertices[idx3]     = newCenterPos.x;
        vertices[idx3 + 1u] = newCenterPos.y;
        vertices[idx3 + 2u] = newCenterPos.z;

        // Обновляем prevPositions, чтобы в следующем кадре не было рывка
        prevPositions[idx3]     = newCenterPos.x;
        prevPositions[idx3 + 1u] = newCenterPos.y;
        prevPositions[idx3 + 2u] = newCenterPos.z;

        // Завершаем обработку этой вершины
        return;
    }

    // // Отладка: принудительно поднимаем центр на 1.0 по Y
    // if (i == uniforms.center) {
    //     let pos = vertices[i];
    //     vertices[i] = vec3<f32>(pos.x, pos.y + 1.0, pos.z);
    //     return;
    // }

    // === 3. Обычные вершины (не углы, не центр) ===

    // Читаем предыдущую позицию
    let prev = vec3<f32>(
        prevPositions[idx3],
        prevPositions[idx3 + 1u],
        prevPositions[idx3 + 2u]
    );

    // Вычисляем ускорение (гравитация, если включена)
    var accel = vec3<f32>(0.0, 0.0, 0.0);
    if (uniforms.enableGravity > 0.5) {
        accel.y = -uniforms.gravity;
    }

    // Verlet-интеграция (для неугловых вершин): newPos = 2*pos - prev + accel * dt^2
    let newPos = pos * 2.0 - prev + accel * uniforms.dt * uniforms.dt;
          
    // сохраняем старую позицию как "предыдущую" для следующего шага
    prevPositions[idx3]      = pos.x;
    prevPositions[idx3 + 1u] = pos.y;
    prevPositions[idx3 + 2u] = pos.z;

    // записываем новую позицию
    vertices[idx3]      = newPos.x;
    vertices[idx3 + 1u] = newPos.y;
    vertices[idx3 + 2u] = newPos.z;
}
`;

// ============================================================
// COMPUTE-ШЕЙДЕР 2: Решение ограничений (PBD constraints)
// ============================================================
const solveShaderCode = `
// Буфер текущих позиций (чтение/запись)
@group(0) @binding(0) var<storage, read_write> vertices: array<f32>;

// Буфер предыдущих позиций (чтение/запись) — для синхронизации
@group(0) @binding(1) var<storage, read_write> prevPositions: array<f32>;

// Буфер рёбер: каждое ребро — это vec3(i, j, restLength)
@group(0) @binding(2) var<storage, read> edges: array<f32>;

// Uniform-параметры (нам нужны только corner's и numIterations)
struct Uniforms {
    dt: f32,
    gravity: f32,
    time: f32,
    enableGravity: f32,
    corner0: u32,
    corner1: u32,
    corner2: u32,
    corner3: u32,
    center: u32,
    amplitude: f32,
    frequency: f32,
    numIterations: f32,
    canvasWidth: f32,
    canvasHeight: f32,
};

@group(0) @binding(3) var<uniform> uniforms: Uniforms;

@compute @workgroup_size(64)
fn solveConstraints(@builtin(global_invocation_id) id: vec3<u32>) {
    let edgeIdx = id.x;
    if (edgeIdx * 3u + 2u >= arrayLength(&edges)) { return; }

    // Читаем ребра из буфера
    let eIdx3 = edgeIdx * 3u;
    let i = u32(edges[eIdx3]);
    let j = u32(edges[eIdx3 + 1u]);
    let restLength = edges[eIdx3 + 2u];

    let i3 = i * 3u;
    let j3 = j * 3u;

    let posI = vec3<f32>(vertices[i3], vertices[i3+1u], vertices[i3+2u]);
    let posJ = vec3<f32>(vertices[j3], vertices[j3+1u], vertices[j3+2u]);
    
    // вектор между вершинами и его длина
    let delta = posI - posJ;
    let currentLength = length(delta);
    if (currentLength < 0.0001) { return; } // защита от деления на ноль (совпадение вершин)
    
    // === PBD: коррекция позиций для соблюдения ограничения длины ===
    // Формула: correction = (currentLength - restLength) / currentLength * 0.5
    // Делим на 2, чтобы сдвинуть обе вершины навстречу друг другу
    
    let correction = (currentLength - restLength) / currentLength * 0.5;
    let correctionVec = delta * correction;

    // Проверяем, закреплена ли вершина (угол или центр)
    let isPinnedI = (i == uniforms.corner0 || i == uniforms.corner1 || 
                     i == uniforms.corner2 || i == uniforms.corner3 || 
                     i == uniforms.center);
    let isPinnedJ = (j == uniforms.corner0 || j == uniforms.corner1 || 
                     j == uniforms.corner2 || j == uniforms.corner3 || 
                     j == uniforms.center);
    
    // Применяем коррекцию и синхронизируем prevPositions
    if (isPinnedI && isPinnedJ) {
        // ничего не делаем
    } else if (isPinnedI) {
        let newJ = posJ + correctionVec * 2.0;
        vertices[j3]   = newJ.x;
        vertices[j3+1u] = newJ.y;
        vertices[j3+2u] = newJ.z;
        prevPositions[j3]   = newJ.x;
        prevPositions[j3+1u] = newJ.y;
        prevPositions[j3+2u] = newJ.z;
    } else if (isPinnedJ) {
        let newI = posI - correctionVec * 2.0;
        vertices[i3]   = newI.x;
        vertices[i3+1u] = newI.y;
        vertices[i3+2u] = newI.z;
        prevPositions[i3]   = newI.x;
        prevPositions[i3+1u] = newI.y;
        prevPositions[i3+2u] = newI.z;
    } else {
        let newI = posI - correctionVec;
        let newJ = posJ + correctionVec;
        vertices[i3]   = newI.x;
        vertices[i3+1u] = newI.y;
        vertices[i3+2u] = newI.z;
        vertices[j3]   = newJ.x;
        vertices[j3+1u] = newJ.y;
        vertices[j3+2u] = newJ.z;

        prevPositions[i3]   = newI.x;
        prevPositions[i3+1u] = newI.y;
        prevPositions[i3+2u] = newI.z;
        prevPositions[j3]   = newJ.x;
        prevPositions[j3+1u] = newJ.y;
        prevPositions[j3+2u] = newJ.z;
    }
}
`;

// // отладка для проверки движения сетки
// const computeShaderCode = `
// @group(0) @binding(0) var<storage, read_write> vertices: array<vec3<f32>>;
// @compute @workgroup_size(64)
// fn main(@builtin(global_invocation_id) id: vec3<u32>) {
//     let i = id.x;
//     if (i >= arrayLength(&vertices)) { return; }
//     let pos = vertices[i];
//     vertices[i] = pos + vec3<f32>(0.0, 0.001, 0.0);
// }
// `;


// Создаём модули шейдеров
const integrateModule = device.createShaderModule({ code: integrateShaderCode });
const solveModule = device.createShaderModule({ code: solveShaderCode });

// Создаём два compute-пайплайна:
// 1. integratePipeline — для Verlet-интеграции
const integratePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
        module: integrateModule,
        entryPoint: 'main',
    },
});

// 2. solvePipeline — для решения ограничений расстояний
const solvePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
        module: solveModule,
        entryPoint: 'solveConstraints',
    },
});


// Создаём два bind group для разных пайплайнов:

// 1. Bind group для интеграции (нужны vertices, prevPositions, uniforms)
const integrateBindGroup = device.createBindGroup({
    layout: integratePipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },       // vertices
        { binding: 1, resource: { buffer: prevPosBuffer } },      // prevPositions
        { binding: 2, resource: { buffer: uniformBuffer } },      // uniforms
    ],
});

// 2. Bind group для решения ограничений (нужны vertices, edges, uniforms)
const solveBindGroup = device.createBindGroup({
    layout: solvePipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },
        { binding: 1, resource: { buffer: prevPosBuffer } },
        { binding: 2, resource: { buffer: edgeBuffer } },
        { binding: 3, resource: { buffer: uniformBuffer } },
    ],
});

// bind group для рендера
const renderBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: uniformBuffer } }
    ]
});

// // отладка для проверки движения сетки
// const bindGroup = device.createBindGroup({
//     layout: computePipeline.getBindGroupLayout(0),
//     entries: [
//         { binding: 0, resource: { buffer: vertexBuffer } },
//     ],
// });

// ============================================================
// 7. Цикл анимации (пока только рендеринг)
// ============================================================
function frame() {
    // console.log('frame called');

    // Обновляем uniform-буфер
    const time = performance.now() / 1000; // текущее время в секундах (пока не используется)
    const gravityCheck = document.getElementById('gravityCheck');
    // const enableGravity = gravityCheck.checked ? 1 : 0;

    // В начале файла у нас есть объявление uniformData:
    // const uniformData = new Float32Array([0.016, 9.8, 0.0, 5.0, 1.0, ...]);

    // Внутри frame() обновляем только нужные поля (сначала я думал создавать копию):
    uniformData[2] = time;                          // время
    uniformData[3] = gravityCheck.checked ? 1 : 0;  // enableGravity (индекс 4, если помните)

    uniformData[12] = canvas.clientWidth;
    uniformData[13] = canvas.clientHeight;
    
    // console.log('time =', time);
    // console.log('centerIndex from cloth:', cloth.centerIndex);
    // console.log('uniformData[9]:', uniformData[9]);
    // console.log('uniformData:', uniformData);

    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const encoder = device.createCommandEncoder();

    // ===========================================
    // COMPUTE-ПРОХОД 1: Verlet-интеграция
    // ===========================================
    const computePass1 = encoder.beginComputePass();
    computePass1.setPipeline(integratePipeline);
    computePass1.setBindGroup(0, integrateBindGroup);
    
    // Запускаем вычисления для всех вершин
    const vertexWorkgroupCount = Math.ceil(cloth.numVertices / 64);
    computePass1.dispatchWorkgroups(vertexWorkgroupCount);
    computePass1.end();
    
    // ===========================================
    // COMPUTE-ПРОХОД 2: Решение ограничений (PBD)
    // ===========================================
    const computePass2 = encoder.beginComputePass();
    computePass2.setPipeline(solvePipeline);
    computePass2.setBindGroup(0, solveBindGroup);
    
    // Читаем количество итераций из uniformData[11]
    const numIterations = Math.floor(uniformData[11]);
    
    // Запускаем решение ограничений несколько раз
    // Чем больше итераций, тем жёстче ткань
    const edgeWorkgroupCount = Math.ceil(cloth.numEdges / 64);
    for (let iter = 0; iter < numIterations; iter++) {
        computePass2.dispatchWorkgroups(edgeWorkgroupCount);
    }
    computePass2.end();

    // ===========================================
    // RENDER-ПРОХОД: отрисовка сетки
    // ===========================================
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
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.drawIndexed(cloth.indices.length);
    renderPass.end();
    
    // Отправляем все команды на GPU
    device.queue.submit([encoder.finish()]);
    
    // Запрашиваем следующий кадр
    requestAnimationFrame(frame);
}

frame();