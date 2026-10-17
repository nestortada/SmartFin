@ReactMethod fun syntheticQueryTiming(name:String,sql:String,arguments:ReadableArray,promise:Promise){
Thread({try{
check(context.packageName=="com.smartfin.atomicityphase1.tests")
check(Regex("atomicity_phase1_[0-9]+_[0-9]+\\.db").matches(name))
check(sql.trimStart().startsWith("SELECT",true))
val params=Array(arguments.size()){arguments.getString(it)?:""}
val result=Arguments.createMap();val samples=Arguments.createArray()
SQLiteDatabase.openDatabase(context.getDatabasePath(name).path,null,SQLiteDatabase.OPEN_READONLY).use{db->
val plan=Arguments.createArray()
try{db.rawQuery("EXPLAIN QUERY PLAN "+sql,params).use{cursor->while(cursor.moveToNext()){val row=Arguments.createMap();for(i in 0 until cursor.columnCount)row.putString(cursor.getColumnName(i),cursor.getString(i));plan.pushMap(row)}}}
catch(e:Exception){result.putString("explainError",e.toString())}
result.putArray("plan",plan)
var count=0;var columns=0
for(sample in 0..3){val start=System.nanoTime();count=0
db.rawQuery(sql,params).use{cursor->columns=cursor.columnCount;while(cursor.moveToNext()){count++;for(column in 0 until columns){when(cursor.getType(column)){1->cursor.getLong(column);2->cursor.getDouble(column);3->cursor.getString(column);4->cursor.getBlob(column)}}}}
val ms=(System.nanoTime()-start)/1000000.0;if(sample>0)samples.pushDouble(ms)}
result.putInt("rows",count);result.putInt("columns",columns);result.putArray("samplesMs",samples)
}
promise.resolve(result)
}catch(e:Exception){promise.reject("SYNTHETIC_QUERY",e)}},"synthetic-query-profiler").start()
}
@ReactMethod fun compareSyntheticDatabases(leftName:String,rightName:String,leftIds:ReadableArray,rightIds:ReadableArray,promise:Promise){
Thread({try{
check(context.packageName=="com.smartfin.atomicityphase1.tests")
for(name in listOf(leftName,rightName))check(Regex("atomicity_phase1_[0-9]+_[0-9]+\\.db").matches(name))
check(leftIds.size()==rightIds.size())
fun quote(value:String)="\""+value.replace("\"","\"\"")+"\""
fun tables(db:SQLiteDatabase):List<String>{val names=mutableListOf<String>();db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",null).use{while(it.moveToNext())names.add(it.getString(0))};return names}
fun columns(db:SQLiteDatabase,table:String):List<String>{val names=mutableListOf<String>();db.rawQuery("PRAGMA table_info("+quote(table)+")",null).use{while(it.moveToNext())names.add(it.getString(1))};return names}
val counts=Arguments.createMap()
SQLiteDatabase.openDatabase(context.getDatabasePath(leftName).path,null,SQLiteDatabase.OPEN_READONLY).use{left->
SQLiteDatabase.openDatabase(context.getDatabasePath(rightName).path,null,SQLiteDatabase.OPEN_READONLY).use{right->
val names=tables(left);check(names==tables(right))
for(table in names){val cols=columns(left,table);check(cols==columns(right,table))
fun query(db:SQLiteDatabase,ids:ReadableArray):android.database.Cursor{
val args=mutableListOf<String>();val projection=cols.joinToString(","){column->
if(ids.size()==0)quote(column) else "CASE "+(0 until ids.size()).joinToString(" "){i->args.add(ids.getString(i)?:"");"WHEN "+quote(column)+" = ? THEN 'generated-payment-"+i+"'"}+" ELSE "+quote(column)+" END AS "+quote(column)}
return db.rawQuery("SELECT "+projection+" FROM "+quote(table)+" ORDER BY "+cols.joinToString(","){quote(it)},args.toTypedArray())}
var count=0
query(left,leftIds).use{a->query(right,rightIds).use{b->while(true){val next=a.moveToNext();check(next==b.moveToNext()){table+": row count"};if(!next)break;count++
for(i in cols.indices){check(a.getType(i)==b.getType(i)){table+": type "+cols[i]}
val same=when(a.getType(i)){0->true;1->a.getLong(i)==b.getLong(i);2->java.lang.Double.doubleToLongBits(a.getDouble(i))==java.lang.Double.doubleToLongBits(b.getDouble(i));3->a.getString(i)==b.getString(i);else->a.getBlob(i).contentEquals(b.getBlob(i))}
check(same){table+": row "+count+", column "+cols[i]}}}}}
counts.putInt(table,count)
}
}}
val result=Arguments.createMap();result.putBoolean("equal",true);result.putMap("tableRows",counts);promise.resolve(result)
}catch(e:Exception){promise.reject("SYNTHETIC_COMPARE",e)}},"synthetic-financial-compare").start()
}
