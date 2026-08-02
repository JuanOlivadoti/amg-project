# `datasets/` — los datos crudos de las corridas de research

Acá vive el **dataset crudo** que produce `kr-service` en cada corrida: todas las keywords
enriquecidas (volumen, dificultad, intención, relevancia, score) más los clusters resultantes. Lo
escribe el checkpoint de `runResearch()` apenas los datos pagos existen — no al final, para que un
aborto no tire a la basura lo que ya se pagó.

| Archivo | Qué es |
| --- | --- |
| `keywords.json` | El dataset de la última corrida. Lo escribe `npm run spike -w kr-service`. Destino configurable con `KR_DATASET_PATH`. |

## Por qué se versiona

**Porque ya lo perdimos una vez.** El dataset de la corrida real del 2026-07-30 (60 keywords, ~$0.31
de DataForSEO) se escribía en `out/keywords.json`, y `out/` está en `.gitignore`. El repo se clonó,
el directorio no viajó, y los datos desaparecieron. Se habían persistido justamente para que
*"ajustar scoring/clustering sea offline y gratis"* — y esa promesa quedó impagable: sin el dataset,
recalibrar `sim_threshold`, la normalización del volumen o las estimaciones de `lib/budget.ts` exige
**pagar otra corrida de producción**.

**No hay nada secreto acá.** Son datos de mercado públicos (volúmenes y dificultades que Google
publica) más el prompt del negocio, que es la descripción comercial que el propio cliente da. Ningún
secreto, ninguna credencial, ningún dato personal. La única razón por la que estaban en un
directorio ignorado era que el CLI escribía todas sus salidas en el mismo sitio.

## Lo que NO puede volver a pasar

El destino por defecto **no puede caer en un directorio que git ignore**. No es una convención: lo
impone un test —`kr-service/src/cli/dataset-path.test.ts`— que le pregunta a `git check-ignore` y
falla si la respuesta es "ignorada". Si algún día hace falta mover el dataset, el test se mueve con
él; lo que no se puede es apagarlo.

Lo demás que escribe el CLI (`out/brief.json`, `out/informe.md`) sigue en `out/`: son entregables
regenerables a partir de este dataset, sin volver a pagarle a nadie.
