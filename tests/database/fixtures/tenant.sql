CREATE TABLE `Company` (
  `Id` INT NOT NULL,
  `CompanyUUID` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `Name` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `UQ_Company_CompanyUUID` (`CompanyUUID`)
);

CREATE TABLE `GeneralSettings` (
  `IdCompany` INT NOT NULL,
  `Param` VARCHAR(128) NOT NULL,
  `Value` TEXT NULL,
  KEY `IX_GeneralSettings_Company_Param` (`IdCompany`, `Param`)
);

CREATE TABLE `Channel` (
  `IdChannel` INT NOT NULL,
  `IdCompany` INT NOT NULL,
  PRIMARY KEY (`IdChannel`)
);

CREATE TABLE `Chat` (
  `IdChat` INT NOT NULL,
  `IdChannel` INT NOT NULL,
  PRIMARY KEY (`IdChat`)
);

CREATE TABLE `Message` (
  `IdMessage` INT NOT NULL,
  `IdChat` INT NOT NULL,
  `Text` MEDIUMTEXT NULL,
  `SenderType` VARCHAR(100) NULL,
  `DateTimeMessage` DATETIME NULL,
  PRIMARY KEY (`IdMessage`)
);

CREATE TABLE `CompanyModule` (
  `IdCompanyModule` INT NOT NULL,
  `IdCompany` INT NOT NULL,
  PRIMARY KEY (`IdCompanyModule`)
);

CREATE TABLE `ProcessLine` (
  `IdProcessLine` INT NOT NULL,
  `IdCompanyModule` INT NOT NULL,
  PRIMARY KEY (`IdProcessLine`)
);

CREATE TABLE `ProcessLineFlow` (
  `IdProcessLineFlow` INT NOT NULL,
  `IdFlow` INT NULL,
  `IdProcessLine` INT NULL,
  `IdChat` INT NULL,
  `IdCompanyModule` INT NULL,
  `Description` VARCHAR(1000) NULL,
  `ObjectDescription` VARCHAR(250) NULL,
  `ObjectType` VARCHAR(250) NULL,
  `DataType` VARCHAR(50) NULL,
  `Level` VARCHAR(250) NULL,
  `LevelOrder` INT NULL,
  `FatherIdFlow` VARCHAR(250) NULL,
  `Param` MEDIUMTEXT NULL,
  `Value` MEDIUMTEXT NULL,
  `IdMessage` INT NULL,
  `ResponseIdMessage` INT NULL,
  PRIMARY KEY (`IdProcessLineFlow`)
);

CREATE TABLE `ERP_Item` (
  `IdItem` INT NOT NULL,
  `IdCompany` INT NULL,
  `ItemCode` VARCHAR(100) NULL,
  `ItemName` VARCHAR(250) NULL,
  `LongDescription` MEDIUMTEXT NULL,
  `Price` DECIMAL(11, 2) NULL,
  `Active` VARCHAR(1) NULL,
  `Status` VARCHAR(50) NULL,
  PRIMARY KEY (`IdItem`, `IdCompany`)
);

CREATE TABLE `ERP_PriceList` (
  `IdPriceList` INT NOT NULL,
  `IdCompany` INT NULL,
  `Code` VARCHAR(50) NULL,
  `Description` VARCHAR(250) NULL,
  PRIMARY KEY (`IdPriceList`, `IdCompany`)
);

CREATE TABLE `ERP_ItemPrice` (
  `IdItemPrice` INT NOT NULL,
  `IdCompany` INT NULL,
  `IdItem` INT NULL,
  `IdPriceList` INT NULL,
  `Price` DECIMAL(11, 4) NULL,
  PRIMARY KEY (`IdItemPrice`, `IdCompany`)
);
