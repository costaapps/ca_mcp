CREATE TABLE `Databases` (
  `IdDatabase` INT NOT NULL,
  `Hostname` VARCHAR(255) NOT NULL,
  `Port` INT NOT NULL,
  `DBName` VARCHAR(128) NOT NULL,
  `Username` VARCHAR(128) NOT NULL,
  `Password` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`IdDatabase`)
);

CREATE TABLE `Company` (
  `IdDatabase` INT NOT NULL,
  `IdCompany` INT NOT NULL,
  `CompanyUUID` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `Name` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`IdDatabase`, `IdCompany`),
  UNIQUE KEY `UQ_Company_CompanyUUID` (`CompanyUUID`),
  CONSTRAINT `FK_Company_Databases` FOREIGN KEY (`IdDatabase`)
    REFERENCES `Databases` (`IdDatabase`)
);
