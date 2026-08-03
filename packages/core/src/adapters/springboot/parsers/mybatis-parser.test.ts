import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseMybatisMappers, extractTablesFromSql } from './mybatis-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-mybatis-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseMybatisMappers', () => {
  it('파일 없으면 빈 배열 반환', async () => {
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('<mapper> 없는 XML 파일은 스킵', async () => {
    await writeFile('src/main/resources/application.xml', `
<configuration>
  <property name="db.url" value="jdbc:oracle:thin:@localhost:1521:XE"/>
</configuration>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('Tier 2: <select resultMap>+단일 FROM → 테이블명+컬럼 연결', async () => {
    await writeFile('src/main/resources/mapper/UserMapper.xml', `
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
    "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.example.mapper.UserMapper">

  <resultMap id="userResultMap" type="com.example.model.User">
    <id column="USER_ID" property="userId"/>
    <result column="USER_NAME" property="userName"/>
    <result column="EMAIL" property="email"/>
  </resultMap>

  <select id="selectUser" resultMap="userResultMap">
    SELECT USER_ID, USER_NAME, EMAIL FROM TB_USER WHERE USER_ID = #{userId}
  </select>

</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('TB_USER')
    const cols = tables[0]?.columns ?? []
    expect(cols.find(c => c.name === 'USER_ID')?.isPrimaryKey).toBe(true)
    expect(cols.find(c => c.name === 'USER_NAME')).toBeDefined()
    expect(cols.find(c => c.name === 'EMAIL')).toBeDefined()
  })

  it('Tier 2: <insert> INTO → 컬럼 없이 테이블명만 등록', async () => {
    await writeFile('src/main/resources/mapper/OrderMapper.xml', `
<mapper namespace="com.example.mapper.OrderMapper">
  <insert id="insertOrder">
    INSERT INTO TB_ORDER (ORDER_ID, USER_ID, AMOUNT) VALUES (#{orderId}, #{userId}, #{amount})
  </insert>
</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('TB_ORDER')
    expect(tables[0]?.columns).toHaveLength(0)
  })

  it('Tier 2: <update> UPDATE → 테이블명 추출', async () => {
    await writeFile('src/main/resources/mapper/ProductMapper.xml', `
<mapper namespace="com.example.mapper.ProductMapper">
  <update id="updateProduct">
    UPDATE TB_PRODUCT SET PRODUCT_NAME = #{name} WHERE PRODUCT_ID = #{id}
  </update>
</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('TB_PRODUCT')
  })

  it('Tier 1 fallback: resultMap이 SELECT에서 미사용 → 클래스 단순명으로 폴백', async () => {
    await writeFile('src/main/resources/mapper/StandaloneMapper.xml', `
<mapper namespace="com.example.mapper.StandaloneMapper">
  <resultMap id="roleMap" type="com.example.model.Role">
    <id column="ROLE_ID" property="roleId"/>
    <result column="ROLE_NAME" property="roleName"/>
  </resultMap>
</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('Role')
    expect(tables[0]?.columns.find(c => c.name === 'ROLE_ID')?.isPrimaryKey).toBe(true)
  })

  it('JOIN이 있는 SELECT(복수 테이블) → 컬럼 없이 테이블별 등록', async () => {
    await writeFile('src/main/resources/mapper/JoinMapper.xml', `
<mapper namespace="com.example.mapper.JoinMapper">
  <resultMap id="userRoleMap" type="com.example.model.UserRole">
    <id column="USER_ID" property="userId"/>
    <result column="ROLE_NAME" property="roleName"/>
  </resultMap>

  <select id="selectUserWithRole" resultMap="userRoleMap">
    SELECT U.USER_ID, R.ROLE_NAME
    FROM TB_USER U
    JOIN TB_ROLE R ON U.ROLE_ID = R.ROLE_ID
  </select>
</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    const names = tables.map(t => t.name)
    expect(names).toContain('TB_USER')
    expect(names).toContain('TB_ROLE')
    // JOIN SELECT: 복수 테이블이라 resultMap columns 연결 안 됨
    const userTable = tables.find(t => t.name === 'TB_USER')
    expect(userTable?.columns).toHaveLength(0)
  })

  it('Oracle 스키마 한정자 처리: SCHEMA.TABLE_NAME → TABLE_NAME만 추출', async () => {
    await writeFile('src/main/resources/mapper/SchemaMapper.xml', `
<mapper namespace="com.example.mapper.SchemaMapper">
  <select id="selectData">
    SELECT * FROM MYSCHEMA.TB_ACCOUNT WHERE STATUS = 'ACTIVE'
  </select>
</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('TB_ACCOUNT')
  })

  it('DUAL/SYSDATE 등 Oracle 가상 테이블 필터링', async () => {
    await writeFile('src/main/resources/mapper/DualMapper.xml', `
<mapper namespace="com.example.mapper.DualMapper">
  <select id="getDate">
    SELECT SYSDATE FROM DUAL
  </select>
</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toHaveLength(0)
  })

  it('@Mapper Java 인터페이스 @Select SQL → 테이블 보충 등록', async () => {
    await writeFile('src/main/java/com/example/mapper/MemberMapper.java', `
package com.example.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface MemberMapper {
    @Select("SELECT MEMBER_ID, MEMBER_NAME FROM TB_MEMBER WHERE MEMBER_ID = #{id}")
    Member selectMember(Long id);
}
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('TB_MEMBER')
  })

  it('XML과 Java 중복 테이블 → 하나로 통합, XML 컬럼 우선', async () => {
    await writeFile('src/main/resources/mapper/UserMapper.xml', `
<mapper namespace="com.example.mapper.UserMapper">
  <resultMap id="userMap" type="com.example.model.User">
    <id column="USER_ID" property="userId"/>
    <result column="USER_NAME" property="userName"/>
  </resultMap>
  <select id="getUser" resultMap="userMap">
    SELECT USER_ID, USER_NAME FROM TB_USER
  </select>
</mapper>
`)
    await writeFile('src/main/java/com/example/mapper/UserMapper.java', `
package com.example.mapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface UserMapper {
    @Select("SELECT * FROM TB_USER WHERE USER_ID = #{id}")
    User getUser(Long id);
}
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    const userTables = tables.filter(t => t.name === 'TB_USER')
    expect(userTables).toHaveLength(1)
    expect(userTables[0]?.columns.length).toBeGreaterThan(0)
  })

  it('복수 mapper XML → 모든 테이블 수집', async () => {
    await writeFile('src/main/resources/mapper/UserMapper.xml', `
<mapper namespace="com.example.mapper.UserMapper">
  <select id="getUser">SELECT * FROM TB_USER</select>
</mapper>
`)
    await writeFile('src/main/resources/mapper/OrderMapper.xml', `
<mapper namespace="com.example.mapper.OrderMapper">
  <select id="getOrder">SELECT * FROM TB_ORDER</select>
</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    const names = tables.map(t => t.name)
    expect(names).toContain('TB_USER')
    expect(names).toContain('TB_ORDER')
  })

  it('NodeId가 결정론적으로 생성됨', async () => {
    await writeFile('src/main/resources/mapper/UserMapper.xml', `
<mapper namespace="com.example.mapper.UserMapper">
  <select id="getUser">SELECT * FROM TB_USER</select>
</mapper>
`)
    const [run1, run2] = await Promise.all([
      parseMybatisMappers(tmpDir, 'test'),
      parseMybatisMappers(tmpDir, 'test'),
    ])
    expect(run1[0]?.id).toBe(run2[0]?.id)
  })

  it('confidence: inferred + inferenceChain 포함', async () => {
    await writeFile('src/main/resources/mapper/UserMapper.xml', `
<mapper namespace="com.example.mapper.UserMapper">
  <select id="getUser">SELECT * FROM TB_USER</select>
</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    const tbl = tables[0]!
    expect(tbl.confidence).toBe('inferred')
    if (tbl.confidence === 'inferred') {
      expect(tbl.inferenceChain.length).toBeGreaterThan(0)
    }
  })

  it('<resultMap extends> → 부모 columns를 상속한다 (N-13)', async () => {
    await writeFile('src/main/resources/mapper/ExtendMapper.xml', `
<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="com.example.mapper.ExtendMapper">

  <resultMap id="baseRM" type="com.example.model.BaseUser">
    <id column="USER_ID" property="userId"/>
    <result column="USER_NAME" property="userName"/>
  </resultMap>

  <resultMap id="extendedRM" extends="baseRM" type="com.example.model.FullUser">
    <result column="EMAIL" property="email"/>
  </resultMap>

  <select id="selectFull" resultMap="extendedRM">
    SELECT USER_ID, USER_NAME, EMAIL FROM TB_FULL_USER WHERE USER_ID = #{id}
  </select>

</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('TB_FULL_USER')
    const cols = tables[0]?.columns ?? []
    expect(cols.find(c => c.name === 'USER_ID')?.isPrimaryKey).toBe(true)
    expect(cols.find(c => c.name === 'USER_NAME')).toBeDefined()
    expect(cols.find(c => c.name === 'EMAIL')).toBeDefined()
    expect(cols).toHaveLength(3)
  })

  it('<association> 내부 <result> columns를 파싱한다 (N-14)', async () => {
    await writeFile('src/main/resources/mapper/AssocMapper.xml', `
<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="com.example.mapper.AssocMapper">

  <resultMap id="userWithAddrMap" type="com.example.model.UserWithAddr">
    <id column="USER_ID" property="userId"/>
    <result column="USER_NAME" property="userName"/>
    <association property="address">
      <result column="STREET" property="street"/>
      <result column="CITY" property="city"/>
    </association>
  </resultMap>

  <select id="selectUserWithAddr" resultMap="userWithAddrMap">
    SELECT USER_ID, USER_NAME, STREET, CITY FROM TB_USER_ADDR WHERE USER_ID = #{id}
  </select>

</mapper>
`)
    const tables = await parseMybatisMappers(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('TB_USER_ADDR')
    const cols = tables[0]?.columns ?? []
    expect(cols.find(c => c.name === 'USER_ID')?.isPrimaryKey).toBe(true)
    expect(cols.find(c => c.name === 'USER_NAME')).toBeDefined()
    expect(cols.find(c => c.name === 'STREET')).toBeDefined()
    expect(cols.find(c => c.name === 'CITY')).toBeDefined()
    // 중복 없이 각 1개
    expect(cols.filter(c => c.name === 'STREET')).toHaveLength(1)
    expect(cols.filter(c => c.name === 'CITY')).toHaveLength(1)
  })
})

describe('extractTablesFromSql — 위생 강화', () => {
  it('SQL 라인주석(--) 안의 FROM은 테이블로 잡지 않는다', () => {
    const sql = `-- SELECT * FROM TB_DEAD\nSELECT * FROM TB_LIVE`
    expect(extractTablesFromSql(sql)).toEqual(['TB_LIVE'])
  })

  it('문자열 리터럴 안의 FROM은 테이블로 잡지 않는다', () => {
    const sql = `SELECT 'from tb_fake' AS S FROM TB_REAL`
    expect(extractTablesFromSql(sql)).toEqual(['TB_REAL'])
  })

  it('WITH CTE 별칭은 테이블 목록에서 제외한다', () => {
    const sql = `WITH tmp AS (SELECT * FROM TB_REAL) SELECT * FROM tmp`
    expect(extractTablesFromSql(sql)).toEqual(['TB_REAL'])
  })

  it('콤마로 연쇄된 다중 CTE(WITH a AS(...), b AS(...))도 전부 제외한다', () => {
    const sql = `WITH a AS (SELECT * FROM TB_A), b AS (SELECT * FROM TB_B) SELECT * FROM a, b`
    expect(extractTablesFromSql(sql).sort()).toEqual(['TB_A', 'TB_B'])
  })

  it('WITH RECURSIVE CTE 자기참조도 테이블 목록에서 제외한다', () => {
    const sql = `WITH RECURSIVE cte_org AS (SELECT * FROM TB_ORG UNION ALL SELECT * FROM cte_org) SELECT * FROM cte_org`
    expect(extractTablesFromSql(sql)).toEqual(['TB_ORG'])
  })

  it('문자열 리터럴 안에 --가 있어도 같은 줄의 실제 FROM절을 잃지 않는다', () => {
    const sql = `SELECT 'a--b' AS x FROM TB_REAL`
    expect(extractTablesFromSql(sql)).toEqual(['TB_REAL'])
  })
})
