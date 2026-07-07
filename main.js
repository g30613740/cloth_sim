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
            // const y = -half + j * step;
            const z = -half + j * step;
            vertices.push(x, 0.0, z);
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

    // Диагональные рёбра (каждый квадрат – два треугольника)
    const triangleIndices = []; // для рендера треугольников
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const v00 = idx(i, j);
            const v10 = idx(i+1, j);
            const v01 = idx(i, j+1);
            const v11 = idx(i+1, j+1);
            // Диагональ от (i,j) к (i+1,j+1)
            addEdge(v00, v11);
            addEdge(v10, v01);   // противоположная диагональ (симметрия)
            // Индексы двух треугольников: (v00, v10, v11) и (v00, v11, v01)
            triangleIndices.push(v00, v10, v11, v00, v11, v01);
        }
    }

    // Перемешиваем рёбра для симметричного PBD
    for (let i = edgeData.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [edgeData[i], edgeData[j]] = [edgeData[j], edgeData[i]];
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
        indices: indexArray,     // линии уже можно не использовать
        triangleIndices: new Uint32Array(triangleIndices), // треугольники
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



// Буфер для треугольников
const triangleIndexBuffer = device.createBuffer({
    size: cloth.triangleIndices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
});
device.queue.writeBuffer(triangleIndexBuffer, 0, cloth.triangleIndices);

// Буфер нормалей
const normalBuffer = device.createBuffer({
    size: cloth.vertices.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
});
// Изначально заполним нулями (позже будем вычислять)
device.queue.writeBuffer(normalBuffer, 0, new Float32Array(cloth.vertices.length));

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


const uniformData = new Float32Array([
    0.001,                   // 0. dt (шаг по времени)
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
    5.0,                     // 11. numIterations (количество итераций PBD)
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

// старый вершинный шейдер
// const vertexShaderCode = `
// struct Uniforms {
//     dt: f32,
//     gravity: f32,
//     time: f32,
//     enableGravity: f32,
//     corner0: f32,
//     corner1: f32,
//     corner2: f32,
//     corner3: f32,
//     center: f32,
//     amplitude: f32,
//     frequency: f32,
//     numIterations: f32,
//     canvasWidth: f32,
//     canvasHeight: f32,
// };

// @group(0) @binding(0) var<uniform> uniforms: Uniforms;

// @vertex
// fn vs_main(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {

//     // Изометрический поворот вокруг X
//     let angle = 0.5;
//     let cosA = cos(angle);
//     let sinA = sin(angle);
//     var p = vec3<f32>(pos.x, pos.y * cosA - pos.z * sinA, pos.y * sinA + pos.z * cosA);
    
//     // Масштаб, чтобы ткань занимала примерно 80% высоты экрана
//     let desiredHeight = 0.8;
//     let clothHalfHeight = 1.0 * cosA; // половина высоты ткани после поворота (max |y|)
//     let scale = desiredHeight / clothHalfHeight;
    
//     // Корректировка по X с учётом aspect ratio
//     let aspect = uniforms.canvasWidth / uniforms.canvasHeight;
//     var xNDC = p.x * scale / aspect;
//     var yNDC = p.y * scale;
    
//     // Опускаем камеру немного вниз, чтобы видеть верхнюю часть ткани
//     // (опционально, зависит от желаемого ракурса)
//     // yNDC -= 0.1;
    
//     return vec4<f32>(xNDC, yNDC, 0.0, 1.0);
// }
// `;

// Старый фрагментный шейдер
// const fragmentShaderCode = `
// @fragment
// fn fs_main() -> @location(0) vec4<f32> {
//     return vec4<f32>(0.8, 0.8, 0.8, 1.0); // Светло-серые линии
// }
// `;

const vertexShaderCode = `
struct Uniforms {
    dt: f32,
    gravity: f32,
    time: f32,
    enableGravity: f32,
    corner0: f32,
    corner1: f32,
    corner2: f32,
    corner3: f32,
    center: f32,
    amplitude: f32,
    frequency: f32,
    numIterations: f32,
    canvasWidth: f32,
    canvasHeight: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) normal: vec3<f32>,
};

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>) -> VertexOutput {
    var out: VertexOutput;
    let angle = 0.5;
    let cosA = cos(angle);
    let sinA = sin(angle);
    // Поворот позиции (тот же, что и раньше)
    var p = vec3<f32>(pos.x, pos.y * cosA - pos.z * sinA, pos.y * sinA + pos.z * cosA);
    let desiredHeight = 0.8;
    let clothHalfHeight = 1.0 * cosA;
    let scale = desiredHeight / clothHalfHeight;
    let aspect = uniforms.canvasWidth / uniforms.canvasHeight;
    out.pos = vec4<f32>(p.x * scale / aspect, p.y * scale, 0.0, 1.0);
    
    // Поворот нормали (та же матрица, так как это чистое вращение)
    out.normal = vec3<f32>(normal.x, normal.y * cosA - normal.z * sinA, normal.y * sinA + normal.z * cosA);

    // ОТЛАДКА: игнорируем входную нормаль, задаём константу (0,0,1)
    // out.normal = vec3<f32>(0.0, 0.0, 1.0);

    return out;
}`;

const fragmentShaderCode = `
struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) normal: vec3<f32>,
};

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let lightDir = normalize(vec3<f32>(0.4, 1.0, 0.2));
    let ambient = 0.55;
    let diff = max(dot(normalize(in.normal), lightDir), 0.0);
    let color = vec3<f32>(0.85, 0.85, 0.95) * (ambient + diff);
    return vec4<f32>(color, 1.0);
}`;


// DEBUGGING 1
// const fragmentShaderCode = `
// struct VertexOutput {
//     @builtin(position) pos: vec4<f32>,
//     @location(0) normal: vec3<f32>,
// };

// @fragment
// fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
//     // Отображаем абсолютные значения нормали (чёрный = (0,0,0) или постоянная)
//     return vec4<f32>(abs(in.normal), 1.0);
// }`;

// DEBUGGING 2
// const fragmentShaderCode = `
// struct VertexOutput {
//     @builtin(position) pos: vec4<f32>,
//     @location(0) normal: vec3<f32>,
// };

// @fragment
// fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
//     let n = normalize(in.normal);
//     return vec4<f32>(n * 0.5 + 0.5, 1.0); // нормаль в диапазоне [0,1]
// }`;

// ===============================
// === Шейдер для расчёта нормалей
// ===============================

const computeNormalsShaderCode = `
// по трём вершинам вычисляет нормаль (через векторное произведение)
// и записывает её в буфер нормалей для всех трёх вершин
@group(0) @binding(0) var<storage, read> vertices: array<f32>;
@group(0) @binding(1) var<storage, read_write> normals: array<f32>;
@group(0) @binding(2) var<storage, read> triIndices: array<u32>; // uint32 индексы треугольников

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let triCount = arrayLength(&triIndices) / 3u;
    if (id.x >= triCount) { return; }
    let i0 = triIndices[id.x * 3u];
    let i1 = triIndices[id.x * 3u + 1u];
    let i2 = triIndices[id.x * 3u + 2u];
    
    let p0 = vec3<f32>(vertices[i0*3u], vertices[i0*3u+1u], vertices[i0*3u+2u]);
    let p1 = vec3<f32>(vertices[i1*3u], vertices[i1*3u+1u], vertices[i1*3u+2u]);
    let p2 = vec3<f32>(vertices[i2*3u], vertices[i2*3u+1u], vertices[i2*3u+2u]);
    
    let n = normalize(cross(p1 - p0, p2 - p0));
    
    normals[i0*3u] = n.x; normals[i0*3u+1u] = n.y; normals[i0*3u+2u] = n.z;
    normals[i1*3u] = n.x; normals[i1*3u+1u] = n.y; normals[i1*3u+2u] = n.z;
    normals[i2*3u] = n.x; normals[i2*3u+1u] = n.y; normals[i2*3u+2u] = n.z;
}`;


// Отладрчный шейдер нормалей (принудительно чисто зелёный)
// const computeNormalsShaderCode = `
// // @group(0) @binding(0) var<storage, read> vertices: array<f32>;
// @group(0) @binding(1) var<storage, read_write> normals: array<f32>;
// // @group(0) @binding(2) var<storage, read> triIndices: array<u32>;

// @compute @workgroup_size(64)
// fn main(@builtin(global_invocation_id) id: vec3<u32>) {
//     let idx = id.x;
//     if (idx * 3u + 2u >= arrayLength(&normals)) { return; }
//     normals[idx*3u] = 0.0;
//     normals[idx*3u+1u] = 1.0;
//     normals[idx*3u+2u] = 0.0;
// }`;

// ============================================================
// 6. Пайплайн рендеринга
// ============================================================
// старый пайплайн рендеринга
// const pipeline = device.createRenderPipeline({
//     layout: 'auto',
//     vertex: {
//         module: device.createShaderModule({ code: vertexShaderCode }),
//         entryPoint: 'vs_main',
//         buffers: [
//             {
//                 // шаг для перехода к следующей вершине
//                 arrayStride: 3 * 4, // 3 float по 4 байта
//                 attributes: [
//                     {
//                         shaderLocation: 0,
//                         offset: 0,
//                         format: 'float32x3',
//                     },
//                 ],
//             },
//         ],
//     },
//     fragment: {
//         module: device.createShaderModule({ code: fragmentShaderCode }),
//         entryPoint: 'fs_main',
//         targets: [{ format }],
//     },
//     primitive: {
//         topology: 'line-list', // Рисуем линии (каждые 2 индекса – отрезок)
//     },
// });

const vsLightModule = device.createShaderModule({ code: vertexShaderCode });
const fsLightModule = device.createShaderModule({ code: fragmentShaderCode });

const trianglePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module: vsLightModule,
        entryPoint: 'vs_main',
        buffers: [
            { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
            { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }
        ]
    },
    fragment: {
        module: fsLightModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' }
});

// Пайплайн для отрисовки линий
const linePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module: vsLightModule,   // тот же вершинный шейдер, но нормали не нужны
        entryPoint: 'vs_main',
        buffers: [
            { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
            { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }
        ]
    },
    fragment: {
        module: device.createShaderModule({ code: `
            @fragment
            fn fs_main() -> @location(0) vec4<f32> {
                return vec4<f32>(0.95, 0.95, 0.95, 1.0); // почти белые линии
            }
        ` }),
        entryPoint: 'fs_main',
        targets: [{ format }],
    },
    primitive: { topology: 'line-list', cullMode: 'none' }
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

struct Uniforms {
    dt: f32,             // шаг по времени
    gravity: f32,
    time: f32,
    enableGravity: f32,  // флаг: вкл/выкл гравитация
    corner0: f32,
    corner1: f32,
    corner2: f32,
    corner3: f32,
    center: f32,
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

    // === 1. Углы закреплены: пропускаем интеграцию ===
    let isCorner = (i == u32(uniforms.corner0) || i == u32(uniforms.corner1) ||
                    i == u32(uniforms.corner2) || i == u32(uniforms.corner3));
    if (isCorner) { return; }

    // === 2. Центральная вершина обраб отдельно, движ по закону синуса ===
    if (i == u32(uniforms.center)) {
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
        vertices[idx3]      = newCenterPos.x;
        vertices[idx3 + 1u] = newCenterPos.y;
        vertices[idx3 + 2u] = newCenterPos.z;

        // Обновляем prevPositions, чтобы в следующем кадре не было рывка
        // prevPositions[idx3]      = newCenterPos.x;
        // prevPositions[idx3 + 1u] = newCenterPos.y;
        // prevPositions[idx3 + 2u] = newCenterPos.z;

        // Завершаем обработку этой вершины
        return;
    }
    
    // === ОТЛАДКА центра ===
    // if (i == u32(uniforms.center)) {
    //     // Жёсткое смещение вверх на 1.5 для проверки
    //     let basePos = vec3<f32>(vertices[idx3], vertices[idx3+1u], vertices[idx3+2u]);
    //     let newPos = vec3<f32>(basePos.x, basePos.y + 1.5, basePos.z);
    //     vertices[idx3]   = newPos.x;
    //     vertices[idx3+1u] = newPos.y;
    //     vertices[idx3+2u] = newPos.z;
    //     // prevPositions[idx3]   = newPos.x;
    //     // prevPositions[idx3+1u] = newPos.y;
    //     // prevPositions[idx3+2u] = newPos.z;
    //     return;
    // }

    // === ОТЛАДКА центра ===
    // if (i == 220u) {
    //     vertices[idx3 + 1u] += 0.05;
    //     prevPositions[idx3 + 1u] += 0.05;
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
    // let newPos = pos * 2.0 - prev + accel * uniforms.dt * uniforms.dt;
    var newPos = pos;
    if (uniforms.enableGravity > 0.5) {
        newPos = pos * 2.0 - prev + accel * uniforms.dt * uniforms.dt;
    }

    // сохраняем старую позицию как "предыдущую" для следующего шага
    prevPositions[idx3]      = pos.x;
    prevPositions[idx3 + 1u] = pos.y;
    prevPositions[idx3 + 2u] = pos.z;

    // записываем новую позицию
    vertices[idx3]      = newPos.x;
    vertices[idx3 + 1u] = newPos.y;
    vertices[idx3 + 2u] = newPos.z;
}


// // === ОТЛАДОЧНЫЙ ШЕЙДЕР ===

// @group(0) @binding(0) var<storage, read_write> vertices: array<f32>;

// struct Uniforms {
//     dt: f32,
//     gravity: f32,
//     time: f32,
//     enableGravity: f32,
//     corner0: u32,
//     corner1: u32,
//     corner2: u32,
//     corner3: u32,
//     center: u32,
//     amplitude: f32,
//     frequency: f32,
//     numIterations: f32,
//     canvasWidth: f32,
//     canvasHeight: f32,
// };

// @compute @workgroup_size(64)
// fn main(@builtin(global_invocation_id) id: vec3<u32>) {
//     let i = id.x;
//     if (i * 3u + 2u >= arrayLength(&vertices)) { return; }
//     let idx = i * 3u;
//     vertices[idx + 1u] += 0.005; // медленный подъём
// }

`;

// ============================================================
// COMPUTE-ШЕЙДЕР 2: Решение ограничений (PBD constraints)
// ============================================================
const solveShaderCode = `
// Буфер текущих позиций (чтение/запись)
@group(0) @binding(0) var<storage, read_write> vertices: array<f32>;

// Буфер предыдущих позиций (чтение/запись) — для синхронизации
// @group(0) @binding(1) var<storage, read_write> prevPositions: array<f32>;

// Буфер рёбер: каждое ребро - это vec3(i, j, restLength)
@group(0) @binding(2) var<storage, read> edges: array<f32>;

// Uniform-параметры (нам нужны только corner's и numIterations)
struct Uniforms {
    dt: f32,
    gravity: f32,
    time: f32,
    enableGravity: f32,
    corner0: f32,
    corner1: f32,
    corner2: f32,
    corner3: f32,
    center: f32,
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
    let isPinnedI = (i == u32(uniforms.corner0) || i == u32(uniforms.corner1) || 
                     i == u32(uniforms.corner2) || i == u32(uniforms.corner3) || 
                     i == u32(uniforms.center));
    let isPinnedJ = (j == u32(uniforms.corner0) || j == u32(uniforms.corner1) || 
                     j == u32(uniforms.corner2) || j == u32(uniforms.corner3) || 
                     j == u32(uniforms.center));
    
    // Применяем коррекцию и синхронизируем prevPositions
    if (isPinnedI && isPinnedJ) {
        // ничего не делаем
    } else if (isPinnedI) {
        let newJ = posJ + correctionVec * 2.0;
        vertices[j3]   = newJ.x;
        vertices[j3+1u] = newJ.y;
        vertices[j3+2u] = newJ.z;
        // prevPositions[j3]   = newJ.x;
        // prevPositions[j3+1u] = newJ.y;
        // prevPositions[j3+2u] = newJ.z;
    } else if (isPinnedJ) {
        let newI = posI - correctionVec * 2.0;
        vertices[i3]   = newI.x;
        vertices[i3+1u] = newI.y;
        vertices[i3+2u] = newI.z;
        // prevPositions[i3]   = newI.x;
        // prevPositions[i3+1u] = newI.y;
        // prevPositions[i3+2u] = newI.z;
    } else {
        let newI = posI - correctionVec;
        let newJ = posJ + correctionVec;
        vertices[i3]   = newI.x;
        vertices[i3+1u] = newI.y;
        vertices[i3+2u] = newI.z;
        vertices[j3]   = newJ.x;
        vertices[j3+1u] = newJ.y;
        vertices[j3+2u] = newJ.z;

        // prevPositions[i3]   = newI.x;
        // prevPositions[i3+1u] = newI.y;
        // prevPositions[i3+2u] = newI.z;
        // prevPositions[j3]   = newJ.x;
        // prevPositions[j3+1u] = newJ.y;
        // prevPositions[j3+2u] = newJ.z;
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

// // =============================================
// // COMPUTE-ШЕЙДЕР 3: синхронизация prevPositions
// // =============================================
// const syncPrevShaderCode = `
// @group(0) @binding(0) var<storage, read> vertices: array<f32>;
// @group(0) @binding(1) var<storage, read_write> prevPositions: array<f32>;
// @group(0) @binding(3) var<uniform> uniforms: Uniforms;

// struct Uniforms {
//     dt: f32,
//     gravity: f32,
//     time: f32,
//     enableGravity: f32,
//     corner0: f32,
//     corner1: f32,
//     corner2: f32,
//     corner3: f32,
//     center: f32,
//     amplitude: f32,
//     frequency: f32,
//     numIterations: f32,
//     canvasWidth: f32,
//     canvasHeight: f32,
// };

// @compute @workgroup_size(64)
// fn main(@builtin(global_invocation_id) id: vec3<u32>) {
//     let i = id.x;
//     if (i * 3u + 2u >= arrayLength(&vertices)) { return; }
//     if (i == u32(uniforms.center)) { return; }  // центр не синхронизируем
//     let idx3 = i * 3u;
//     prevPositions[idx3]   = vertices[idx3];
//     prevPositions[idx3+1u] = vertices[idx3+1u];
//     prevPositions[idx3+2u] = vertices[idx3+2u];
// }
// `;

// ==============================================================================
// COMPUTE-ШЕЙДЕР 4: Решение ограничений (PBD constraints) в обратном направлении
// ==============================================================================

// добавляю из-за асимметрии
// проход в обратном направлении

const solveReverseShaderCode = `
@group(0) @binding(0) var<storage, read_write> vertices: array<f32>;
@group(0) @binding(2) var<storage, read> edges: array<f32>;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

struct Uniforms {
    dt: f32,
    gravity: f32,
    time: f32,
    enableGravity: f32,
    corner0: f32,
    corner1: f32,
    corner2: f32,
    corner3: f32,
    center: f32,
    amplitude: f32,
    frequency: f32,
    numIterations: f32,
    canvasWidth: f32,
    canvasHeight: f32,
};

@compute @workgroup_size(64)
fn solveConstraintsReverse(@builtin(global_invocation_id) id: vec3<u32>) {
    let totalEdges = arrayLength(&edges) / 3u;
    if (id.x >= totalEdges) { return; }    // underflow защита
    let edgeIdx = totalEdges - 1u - id.x;  // обратный порядок
    if (edgeIdx * 3u + 2u >= arrayLength(&edges)) { return; }

    let eIdx3 = edgeIdx * 3u;
    let i = u32(edges[eIdx3]);
    let j = u32(edges[eIdx3 + 1u]);
    let restLength = edges[eIdx3 + 2u];

    // весь остальной код точно как в solveShaderCode, включая коррекцию и проверки isPinnedI/J
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
    let isPinnedI = (i == u32(uniforms.corner0) || i == u32(uniforms.corner1) || 
                     i == u32(uniforms.corner2) || i == u32(uniforms.corner3) || 
                     i == u32(uniforms.center));
    let isPinnedJ = (j == u32(uniforms.corner0) || j == u32(uniforms.corner1) || 
                     j == u32(uniforms.corner2) || j == u32(uniforms.corner3) || 
                     j == u32(uniforms.center));
    
    // Применяем коррекцию и синхронизируем prevPositions
    if (isPinnedI && isPinnedJ) {
        // ничего не делаем
    } else if (isPinnedI) {
        let newJ = posJ + correctionVec * 2.0;
        vertices[j3]   = newJ.x;
        vertices[j3+1u] = newJ.y;
        vertices[j3+2u] = newJ.z;
        // prevPositions[j3]   = newJ.x;
        // prevPositions[j3+1u] = newJ.y;
        // prevPositions[j3+2u] = newJ.z;
    } else if (isPinnedJ) {
        let newI = posI - correctionVec * 2.0;
        vertices[i3]   = newI.x;
        vertices[i3+1u] = newI.y;
        vertices[i3+2u] = newI.z;
        // prevPositions[i3]   = newI.x;
        // prevPositions[i3+1u] = newI.y;
        // prevPositions[i3+2u] = newI.z;
    } else {
        let newI = posI - correctionVec;
        let newJ = posJ + correctionVec;
        vertices[i3]   = newI.x;
        vertices[i3+1u] = newI.y;
        vertices[i3+2u] = newI.z;
        vertices[j3]   = newJ.x;
        vertices[j3+1u] = newJ.y;
        vertices[j3+2u] = newJ.z;

        // prevPositions[i3]   = newI.x;
        // prevPositions[i3+1u] = newI.y;
        // prevPositions[i3+2u] = newI.z;
        // prevPositions[j3]   = newJ.x;
        // prevPositions[j3+1u] = newJ.y;
        // prevPositions[j3+2u] = newJ.z;
    }
}
`;


// ===============
// SHADER-MODULES:
// ===============

const integrateModule = device.createShaderModule({ code: integrateShaderCode });
const solveModule = device.createShaderModule({ code: solveShaderCode });
// const syncPrevModule = device.createShaderModule({ code: syncPrevShaderCode });
const solveReverseModule = device.createShaderModule({ code: solveReverseShaderCode });
const computeNormalsModule = device.createShaderModule({ code: computeNormalsShaderCode });


// ==================
// COMPUTE-PIPELINES:
// ==================

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

// // 3. syncPrevPipeline - для синхронизации движения
// const syncPrevPipeline = device.createComputePipeline({
//     layout: 'auto',
//     compute: {
//         module: syncPrevModule, 
//         entryPoint: 'main' },
// });

// 4. solveReversePipeline - для обратного прохода ограничения длин
const solveReversePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { 
        module: solveReverseModule,
        entryPoint: 'solveConstraintsReverse' },
});

// 5. Нормали
const computeNormalsPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: computeNormalsModule, entryPoint: 'main' },
});


// ============
// BIND-GROUPS:
// ============

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
        // { binding: 1, resource: { buffer: prevPosBuffer } },
        { binding: 2, resource: { buffer: edgeBuffer } },
        { binding: 3, resource: { buffer: uniformBuffer } },
    ],
});

// // 3. Bind group для синхронизации
// const syncPrevBindGroup = device.createBindGroup({
//     layout: syncPrevPipeline.getBindGroupLayout(0),
//     entries: [
//         { binding: 0, resource: { buffer: vertexBuffer } },
//         { binding: 1, resource: { buffer: prevPosBuffer } },
//         { binding: 3, resource: { buffer: uniformBuffer } },
//     ],
// });

// 4. Bind group для обратного прохода
const solveReverseBindGroup = device.createBindGroup({
    layout: solveReversePipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },
        // { binding: 1, resource: { buffer: prevPosBuffer } },
        { binding: 2, resource: { buffer: edgeBuffer } },
        { binding: 3, resource: { buffer: uniformBuffer } },
    ],
});

// 5. bind group для рендера
const renderBindGroup = device.createBindGroup({
    layout: trianglePipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: uniformBuffer } }
    ]
});

// 5. bind group для вычисления нормалей
const computeNormalsBindGroup = device.createBindGroup({
    layout: computeNormalsPipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },
        { binding: 1, resource: { buffer: normalBuffer } },
        { binding: 2, resource: { buffer: triangleIndexBuffer } }
    ]
});

// bind для отрисовки линий
const lineBindGroup = device.createBindGroup({
    layout: linePipeline.getBindGroupLayout(0),
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
    // console.log('corners:', cloth.cornerIndices)
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

    // Читаем количество итераций из uniformData[11]
    const numIterations = Math.floor(uniformData[11]);
    const edgeWorkgroupCount = Math.ceil(cloth.numEdges / 64);

    for (let iter = 0; iter < numIterations; iter++) {
        // Прямой проход
        computePass2.setPipeline(solvePipeline);
        computePass2.setBindGroup(0, solveBindGroup);
        computePass2.dispatchWorkgroups(edgeWorkgroupCount);

        // Обратный проход
        computePass2.setPipeline(solveReversePipeline);
        computePass2.setBindGroup(0, solveReverseBindGroup);
        computePass2.dispatchWorkgroups(edgeWorkgroupCount);
    }

    computePass2.end();

    const computeNormalsPass = encoder.beginComputePass();
    computeNormalsPass.setPipeline(computeNormalsPipeline);
    computeNormalsPass.setBindGroup(0, computeNormalsBindGroup);
    const triWorkgroupCount = Math.ceil(cloth.triangleIndices.length / 3 / 64);
    computeNormalsPass.dispatchWorkgroups(triWorkgroupCount);
    computeNormalsPass.end();

    // // ==============================================
    // // COMPUTE-ПРОХОД 3: Синхронизация prevPositions)
    // // ==============================================
    // const computePass3 = encoder.beginComputePass();
    // computePass3.setPipeline(syncPrevPipeline);
    // computePass3.setBindGroup(0, syncPrevBindGroup);
    // computePass3.dispatchWorkgroups(vertexWorkgroupCount);
    // computePass3.end();

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
    
    // renderPass.setPipeline(pipeline);
    // renderPass.setVertexBuffer(0, vertexBuffer);
    // renderPass.setIndexBuffer(indexBuffer, 'uint32');
    // renderPass.setBindGroup(0, renderBindGroup);
    // renderPass.drawIndexed(cloth.indices.length);
    // renderPass.end();

    renderPass.setPipeline(trianglePipeline);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.setVertexBuffer(1, normalBuffer);
    renderPass.setIndexBuffer(triangleIndexBuffer, 'uint32');
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.drawIndexed(cloth.triangleIndices.length);

    // Рисуем линии поверх треугольников
    renderPass.setPipeline(linePipeline);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.setVertexBuffer(1, normalBuffer); // не используется, но нужно для совместимости макета
    renderPass.setIndexBuffer(indexBuffer, 'uint32');
    renderPass.setBindGroup(0, lineBindGroup);
    renderPass.drawIndexed(cloth.indices.length);

    renderPass.end();
    
    // Отправляем все команды на GPU
    device.queue.submit([encoder.finish()]);
    
    // Запрашиваем следующий кадр
    requestAnimationFrame(frame);
}

frame();